import { defineStore } from 'pinia'
import type {
  AlertLevel,
  BreakerCheckResult,
  BreakerResetResult,
  BreakerTrip,
  CommandResult,
  Device,
  DeviceCommand,
  DeviceEvent,
  HouseSettings,
  Reading
} from '#shared/types/smartRoom'
import type { AlertLogEntry } from '~/utils/alertLog'
import type { Mission } from '#shared/utils/missions'

const DAY_MS = 24 * 60 * 60 * 1000

export interface EnergySummary {
  // 今天（0 點起）用了幾度
  todayKwh: number
  last24hKwh: number
  // 照過去 24 小時的用法，一個月大約幾度、電費多少（累進電價）
  monthlyKwh: number
  monthlyBill: number
  summer: boolean
}

// 沒有 Realtime（記憶體模式、沒設定 publishable key、連線中斷）時的輪詢間隔
const POLL_INTERVAL_MS = 10_000
// 歷史曲線定期重抓，讓圖表右端跟著時間往前推；即時狀態不靠它，靠下面每秒的推算
const HISTORY_REFRESH_MS = 60_000
const CLOCK_TICK_MS = 1_000
// 倒數結束後請伺服器結算跳電；還在超載就每隔這麼久再問一次（例如時鐘跟伺服器有誤差）
const BREAKER_RETRY_MS = 3_000
// 操作失敗的訊息顯示多久後自動消失
const COMMAND_ERROR_MS = 6_000

export type LiveMode = 'connecting' | 'realtime' | 'polling'

export const useDevicesStore = defineStore('devices', () => {
  const devices = ref<Device[]>([])
  // 過去 24 小時的讀數：給圖表與倒帶用
  const history = ref<Record<string, Reading[]>>({})
  // 每台電器目前生效的事件：即時狀態由它 + 現在時間推算（readingFromEvent）
  const latestEvents = ref<Record<string, DeviceEvent | null>>({})
  const selectedId = ref<string | null>(null)
  // null 代表「即時」；有值時代表拉桿倒帶到的時間點
  const playhead = ref<number | null>(null)
  const now = ref<number>(Date.now())
  const loading = ref<boolean>(false)
  // 第一次成功載入資料了沒（進頁面的 loading 畫面用）
  const loaded = ref<boolean>(false)
  const error = ref<string | null>(null)
  const liveMode = ref<LiveMode>('connecting')
  const pendingDeviceId = ref<string | null>(null)
  const commandError = ref<string | null>(null)
  const houseLimit = ref<number>(DEFAULT_HOUSE_LIMIT_WATTS)
  // 跳電中（停電）的時間點；null 代表有電
  const trippedAt = ref<string | null>(null)
  // 過去 24 小時每次跳電的時間點（「今天不要跳電」任務用）
  const trips = ref<{ at: number; guided: boolean }[]>([])
  const resetting = ref<boolean>(false)
  // 全屋從什麼時候開始連續超載（前端自己觀察到的），用來顯示跳電倒數
  const overSince = ref<number | null>(null)
  let lastBreakerCheck = 0

  const stream = useDeviceEventStream()
  let timers: ReturnType<typeof setInterval>[] = []
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null
  // startLive 裡有 await，元件可能在等待期間就卸載了；用世代編號辨識過期的那次啟動
  let generation = 0
  const refreshQueue = new Map<string, ReturnType<typeof setTimeout>>()

  async function fetchHistory(deviceId: string) {
    history.value[deviceId] = await $fetch<Reading[]>(`/api/devices/${deviceId}/readings`, { query: { range: '24h' } })
  }

  // 第一次載入直接放進去；之後只更新閾值，保留原本的物件——整個換掉的話 3D 場景會以為電器變了而重建模型
  function mergeDevices(list: Device[]) {
    if (devices.value.length === 0) {
      devices.value = list
      selectedId.value ??= list[0]?.id ?? null
      return
    }
    for (const fresh of list) applyThreshold(fresh.id, fresh.power_threshold_watts)
  }

  function applySettings(settings: HouseSettings) {
    houseLimit.value = settings.house_limit_watts
    // 復電了（可能是別人、或後台遠端復電）：停電時按家電留下的「停電中」錯誤訊息已經不成立
    if (trippedAt.value && !settings.tripped_at) commandError.value = null
    trippedAt.value = settings.tripped_at
  }

  let commandErrorTimer: ReturnType<typeof setTimeout> | undefined
  watch(commandError, (message) => {
    clearTimeout(commandErrorTimer)
    if (message) commandErrorTimer = setTimeout(() => (commandError.value = null), COMMAND_ERROR_MS)
  })

  function applyThreshold(deviceId: string, watts: number) {
    const device = devices.value.find((d) => d.id === deviceId)
    if (device && device.power_threshold_watts !== watts) device.power_threshold_watts = watts
  }

  async function loadAll() {
    loading.value = true
    try {
      // 先抓目前狀態：這支 API 會順便結算跳電，之後抓的歷史才會包含斷電事件
      const events = await $fetch<Record<string, DeviceEvent | null>>('/api/events/latest')
      const [list, settings, tripList] = await Promise.all([
        $fetch<Device[]>('/api/devices'),
        $fetch<HouseSettings>('/api/settings'),
        $fetch<BreakerTrip[]>('/api/breaker/trips')
      ])
      trips.value = tripList.map((trip) => ({ at: Date.parse(trip.at), guided: trip.guided }))
      mergeDevices(list)
      applySettings(settings)
      await Promise.all(devices.value.map((device) => fetchHistory(device.id)))
      latestEvents.value = events
      now.value = Date.now()
      error.value = null
      loaded.value = true
    } catch (err) {
      console.error('[devices] 載入失敗', err)
      error.value = '資料載入失敗，稍後會自動重試'
    } finally {
      loading.value = false
    }
  }

  async function refreshHistories() {
    try {
      await Promise.all(devices.value.map((device) => fetchHistory(device.id)))
    } catch (err) {
      console.error('[devices] 歷史資料更新失敗', err)
    }
  }

  // 同一台電器短時間內連續收到多筆事件（例如連按調溫度），只重抓一次歷史
  function scheduleHistoryRefresh(deviceId: string) {
    clearTimeout(refreshQueue.get(deviceId))
    refreshQueue.set(
      deviceId,
      setTimeout(() => {
        refreshQueue.delete(deviceId)
        fetchHistory(deviceId).catch((err) => console.error('[devices] 歷史資料更新失敗', err))
      }, 500)
    )
  }

  function applyEvent(event: DeviceEvent) {
    // 跳電時每台家電各推播一筆 system 事件，時間點都一樣，只記一次
    if (event.source === 'system' && !event.power_on) {
      const at = Date.parse(event.timestamp)
      if (!trips.value.some((trip) => trip.at === at)) trips.value = [...trips.value, { at, guided: event.guided }]
    }
    const current = latestEvents.value[event.device_id]
    // Realtime 推播與指令 API 的回應可能先後順序顛倒，只接受比目前更新的事件
    if (!current || Date.parse(event.timestamp) >= Date.parse(current.timestamp)) {
      latestEvents.value[event.device_id] = event
    }
    scheduleHistoryRefresh(event.device_id)
  }

  function setPolling(enabled: boolean) {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = enabled ? setInterval(loadAll, POLL_INTERVAL_MS) : null
  }

  async function startLive() {
    stopLive()
    const myGeneration = ++generation
    timers.push(setInterval(() => (now.value = Date.now()), CLOCK_TICK_MS))
    timers.push(setInterval(refreshHistories, HISTORY_REFRESH_MS))
    liveMode.value = 'connecting'
    await loadAll()

    const stop = await stream.subscribe({
      onEvent: applyEvent,
      onThreshold: applyThreshold,
      onSettings: applySettings,
      onStatus: (connected) => {
        if (myGeneration !== generation) return
        liveMode.value = connected ? 'realtime' : 'polling'
        setPolling(!connected)
        // 剛連上（或重新連上）時，補抓斷線期間可能錯過的事件
        if (connected) loadAll()
      }
    })
    if (myGeneration !== generation) {
      stop?.()
      return
    }
    unsubscribe = stop
    if (!stop) {
      liveMode.value = 'polling'
      setPolling(true)
    }
  }

  function stopLive() {
    generation++
    timers.forEach(clearInterval)
    timers = []
    setPolling(false)
    unsubscribe?.()
    unsubscribe = null
  }

  const timeBounds = computed<{ min: number; max: number } | null>(() => {
    let min = Infinity
    let max = -Infinity
    for (const list of Object.values(history.value)) {
      if (list.length === 0) continue
      min = Math.min(min, Date.parse(list[0]!.timestamp))
      max = Math.max(max, Date.parse(list[list.length - 1]!.timestamp))
    }
    return Number.isFinite(min) ? { min, max } : null
  })

  const currentReadings = computed<Record<string, Reading | null>>(() =>
    Object.fromEntries(
      devices.value.map((device) => [
        device.id,
        playhead.value === null
          ? readingFromEvent(device, latestEvents.value[device.id] ?? null, now.value)
          : readingAtTime(history.value[device.id] ?? [], playhead.value)
      ])
    )
  )

  const selectedDevice = computed<Device | null>(() => devices.value.find((d) => d.id === selectedId.value) ?? null)

  const totalWatts = computed<number>(() =>
    Object.values(currentReadings.value).reduce((sum, reading) => sum + (reading?.power_watts ?? 0), 0)
  )

  const houseLevel = computed<AlertLevel>(() => houseAlertLevel(totalWatts.value, houseLimit.value))

  const alertLog = computed<AlertLogEntry[]>(() => buildAlertLog(devices.value, history.value, houseLimit.value))

  // ---- 電費試算、每日任務：都從 24 小時歷史讀數算 ----
  const energy = computed<EnergySummary>(() => {
    const dayStart = startOfLocalDay(now.value)
    let todayKwh = 0
    let last24hKwh = 0
    for (const device of devices.value) {
      const readings = history.value[device.id] ?? []
      todayKwh += energyKwh(readings, dayStart, now.value)
      last24hKwh += energyKwh(readings, now.value - DAY_MS, now.value)
    }
    const summer = isSummer(new Date(now.value))
    const monthlyKwh = last24hKwh * DAYS_PER_MONTH
    return { todayKwh, last24hKwh, monthlyKwh, monthlyBill: monthlyBill(monthlyKwh, summer), summer }
  })

  const missions = computed<Mission[]>(() =>
    dailyMissions({
      dayStart: startOfLocalDay(now.value),
      now: now.value,
      devices: devices.value,
      history: history.value,
      trips: trips.value
    })
  )

  // ---- 跳電 ----
  // 倒數只是給玩家看的；真正什麼時候跳電由伺服器依事件精確算出，倒數結束時請伺服器結算一次
  watch([houseLevel, now, playhead], () => {
    if (playhead.value !== null || houseLevel.value !== 'alert') {
      overSince.value = null
      return
    }
    overSince.value ??= now.value
    if (now.value - overSince.value >= BREAKER_GRACE_MS && now.value - lastBreakerCheck >= BREAKER_RETRY_MS) {
      lastBreakerCheck = now.value
      checkBreaker()
    }
  })

  const breakerCountdown = computed<number | null>(() =>
    overSince.value === null ? null : Math.max(0, Math.ceil((overSince.value + BREAKER_GRACE_MS - now.value) / 1000))
  )

  // 跳電、自動復電都由伺服器結算；有 Realtime 的話新事件會自己推播過來，輪詢模式就馬上重抓，不用等下一輪
  async function checkBreaker() {
    try {
      await $fetch<BreakerCheckResult>('/api/breaker/check', { method: 'POST' })
      if (liveMode.value !== 'realtime') await loadAll()
    } catch (err) {
      console.error('[devices] 跳電結算失敗', err)
    }
  }

  // 停電中：只看「現在」；倒帶時看的是歷史，不顯示停電狀態
  const powerOut = computed<boolean>(() => playhead.value === null && trippedAt.value !== null)

  // 停電太久會自動復電：剩幾秒（給畫面顯示），時間到了請伺服器結算一次。
  // 沒有人操作家電的話伺服器不會主動結算，所以由開著頁面的人觸發，跟跳電倒數同一個做法
  const autoRestoreIn = computed<number | null>(() =>
    !powerOut.value || !trippedAt.value
      ? null
      : Math.max(0, Math.ceil((Date.parse(trippedAt.value) + OUTAGE_AUTO_RESTORE_MS - now.value) / 1000))
  )
  watch(autoRestoreIn, (seconds) => {
    if (seconds === 0 && now.value - lastBreakerCheck >= BREAKER_RETRY_MS) {
      lastBreakerCheck = now.value
      checkBreaker()
    }
  })

  // 復電（前台玩家在電箱、後台遠端）。事件與設定會透過 Realtime 推播回來；輪詢模式就馬上重抓
  async function resetBreaker(source: 'player' | 'admin') {
    resetting.value = true
    commandError.value = null
    try {
      const result = await $fetch<BreakerResetResult>('/api/breaker/reset', { method: 'POST', body: { source } })
      if (result.restored) applySettings({ house_limit_watts: houseLimit.value, tripped_at: null })
      if (liveMode.value !== 'realtime') await loadAll()
    } catch (err) {
      commandError.value = apiErrorMessage(err, '復電失敗，請稍後再試')
    } finally {
      resetting.value = false
    }
  }

  // ---- 後台設定（需要管理員登入，失敗時把錯誤丟給呼叫端顯示） ----
  async function updateThreshold(deviceId: string, watts: number) {
    const device = await $fetch<Device>(`/api/devices/${deviceId}`, { method: 'PATCH', body: { power_threshold_watts: watts } })
    applyThreshold(device.id, device.power_threshold_watts)
  }

  async function updateHouseLimit(watts: number) {
    const settings = await $fetch<HouseSettings>('/api/settings', { method: 'PATCH', body: { house_limit_watts: watts } })
    applySettings(settings)
  }

  async function sendCommand(deviceId: string, command: DeviceCommand) {
    pendingDeviceId.value = deviceId
    commandError.value = null
    try {
      const result = await $fetch<CommandResult>(`/api/devices/${deviceId}/commands`, { method: 'POST', body: command })
      // 操作的是「現在」，正在倒帶的話跳回即時，才看得到操作的結果
      playhead.value = null
      now.value = Date.now()
      if (result.event) applyEvent(result.event)
      // 指令執行前伺服器可能剛結算了一次跳電，其他電器的斷電事件在輪詢模式下要重抓才看得到
      if (liveMode.value !== 'realtime') await loadAll()
    } catch (err) {
      commandError.value = apiErrorMessage(err, '操作失敗，請稍後再試')
    } finally {
      pendingDeviceId.value = null
    }
  }

  function select(id: string) {
    selectedId.value = id
  }

  function setPlayhead(time: number | null) {
    // 拉到最右邊就等同回到即時
    playhead.value = time !== null && timeBounds.value && time >= timeBounds.value.max ? null : time
  }

  return {
    devices,
    history,
    latestEvents,
    selectedId,
    playhead,
    now,
    loading,
    loaded,
    error,
    liveMode,
    pendingDeviceId,
    commandError,
    timeBounds,
    currentReadings,
    selectedDevice,
    totalWatts,
    houseLevel,
    houseLimit,
    alertLog,
    breakerCountdown,
    autoRestoreIn,
    powerOut,
    energy,
    missions,
    resetting,
    resetBreaker,
    updateThreshold,
    updateHouseLimit,
    startLive,
    stopLive,
    sendCommand,
    select,
    setPlayhead
  }
})
