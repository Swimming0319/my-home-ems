import type { CommandSource, DeviceEvent } from '#shared/types/smartRoom'
import { findBreakerTrip, OUTAGE_AUTO_RESTORE_MS, resumesAfterOutage, tripEvents } from '#shared/utils/breaker'
import type { Repo, StoredSettings } from './repo'

// 最多往回追溯多久。比這更早的超載就不補跳電了，也避免每次檢查都掃描整個事件表
const LOOKBACK_MS = 24 * 60 * 60 * 1000

// 「延遲結算」的跳電：伺服器沒有背景程序一直盯著用電，所以在每次送指令、讀取目前狀態時，
// 先算出從上次跳電到現在，第一個該跳電的時間點，把斷電事件補寫在那個時間點上。
// 不管當下有沒有人開著頁面，結果都一樣——就算沒人在線，下次有人打開時歷史也會是正確的。
// 跳電後整間停電（house_settings.tripped_at），復電前不會再跳一次，所以一次最多結算一次跳電。
// 停電滿 OUTAGE_AUTO_RESTORE_MS 還沒人復電，就先把自動復電補寫在那個時間點，再繼續往後結算
export async function advanceBreaker(repo: Repo, now: number): Promise<number | null> {
  const devices = await repo.listDevices()
  let settings = await repo.getSettings()
  if (settings.tripped_at) {
    const autoRestoreAt = Date.parse(settings.tripped_at) + OUTAGE_AUTO_RESTORE_MS
    if (now < autoRestoreAt) return null
    await restoreAt(repo, settings, autoRestoreAt, 'auto')
    settings = await repo.getSettings()
  }

  const previous = await repo.latestSystemEvent()
  // 上次跳電、上次改契約容量、上次復電之前的狀況都已經結算過了，從那之後開始找
  const from = Math.max(
    now - LOOKBACK_MS,
    previous ? Date.parse(previous.timestamp) : -Infinity,
    settings.breaker_settled_at ? Date.parse(settings.breaker_settled_at) : -Infinity
  )

  const entries = await Promise.all(
    devices.map(async (device): Promise<[string, DeviceEvent[]]> => {
      const [initial, events] = await Promise.all([
        repo.latestEvent(device.id, new Date(from)),
        repo.listEvents(device.id, new Date(from), new Date(now))
      ])
      return [device.id, initial ? [initial, ...events] : events]
    })
  )
  const eventsByDevice = Object.fromEntries(entries)

  const tripAt = findBreakerTrip(devices, eventsByDevice, from, now, settings.house_limit_watts)
  if (tripAt === null) return null
  await repo.insertEventsIgnoringDuplicates(tripEvents(devices, eventsByDevice, tripAt))
  await repo.updateSettings({ ...settings, tripped_at: new Date(tripAt).toISOString() })
  return tripAt
}

// 復電（把電箱的總開關扳回去）：冰箱、跳電前開著的電燈自動恢復，其他家電維持關閉。
// 停電已經超過自動復電的時間，advanceBreaker 會先自動復電，這裡就回傳 false（沒有要復的電）
export async function restorePower(repo: Repo, now: number, source: Exclude<CommandSource, 'system' | 'auto'>): Promise<boolean> {
  await advanceBreaker(repo, now)
  const settings = await repo.getSettings()
  if (!settings.tripped_at) return false
  await restoreAt(repo, settings, now, source)
  return true
}

// 每台家電都寫一筆新事件，蓋掉跳電時「沒有電」的那筆，待機電才會回來。
// 來源不能是 system（system 的斷電事件代表沒有電，也會被算成一次跳電）。
// 同時有兩個請求結算同一次自動復電時，時間點一樣，重複的事件會被唯一索引擋掉
async function restoreAt(repo: Repo, settings: StoredSettings, at: number, source: Exclude<CommandSource, 'system'>): Promise<void> {
  const trippedAt = Date.parse(settings.tripped_at!)
  const timestamp = new Date(at).toISOString()
  const devices = await repo.listDevices()
  const events = await Promise.all(
    devices.map(async (device): Promise<DeviceEvent> => {
      // 跳電前最後一筆事件（跳電的斷電事件剛好在 trippedAt，所以往前 1 毫秒）
      const before = await repo.latestEvent(device.id, new Date(trippedAt - 1))
      const resume = resumesAfterOutage(device, before)
      return {
        device_id: device.id,
        timestamp,
        power_on: resume,
        set_temp_c: before?.set_temp_c ?? null,
        started_at: resume ? timestamp : null,
        source,
        guided: false
      }
    })
  )
  await repo.insertEventsIgnoringDuplicates(events)
  await repo.updateSettings({ ...settings, tripped_at: null, breaker_settled_at: timestamp })
}
