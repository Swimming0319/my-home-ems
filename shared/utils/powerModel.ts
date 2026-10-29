import type { Device, DeviceEvent, Reading, WashPhase } from '../types/smartRoom'
import { AC_DEFAULT_TEMP } from './alerts'

// 用電模型：家電在某個時間點的讀數，完全由「當時生效的那筆事件 + 經過多久」決定。
// 兩次事件之間不需要寫任何資料，查詢時才把讀數算出來（規劃文件「資料模型」）。
// 放在 shared/：後端用它算歷史讀數，前端用它每秒推算「現在」的讀數——洗衣行程切換、
// 冷氣開機高峰結束這些變化不會產生事件，前端不能只靠 Realtime 推播的事件更新畫面。

export const SLOT_MS = 5 * 60 * 1000

const AC_SURGE_MS = 15 * 60 * 1000

// 洗衣行程，每段 5 分鐘：進水 → 加熱洗滌 → 洗滌 → 洗清進水 → 脫水。
// 加熱那段刻意超過洗衣機的閾值，讓警示有機會出現。
export const WASH_STEP_MS = 5 * 60 * 1000
export const WASH_CYCLE: { phase: WashPhase; watts: number; liters: number }[] = [
  { phase: 'fill', watts: 150, liters: 15 },
  { phase: 'fill', watts: 150, liters: 15 },
  { phase: 'heat', watts: 1800, liters: 0 },
  { phase: 'heat', watts: 1800, liters: 0 },
  { phase: 'heat', watts: 1750, liters: 0 },
  { phase: 'wash', watts: 500, liters: 0 },
  { phase: 'wash', watts: 500, liters: 0 },
  { phase: 'wash', watts: 450, liters: 0 },
  { phase: 'rinse', watts: 150, liters: 20 },
  { phase: 'spin', watts: 400, liters: 0 },
  { phase: 'spin', watts: 700, liters: 0 },
  { phase: 'spin', watts: 900, liters: 0 }
]
export const WASH_DURATION_MS = WASH_CYCLE.length * WASH_STEP_MS

function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// 讀數上的小幅雜訊，模擬真實電表的跳動。種子由（電器, 5 分鐘時間槽）決定，
// 同一個時間點不管查幾次數值都一樣，圖表才不會每次輪詢都抖一下。
function noise(deviceId: string, time: number, amplitude: number): number {
  const slot = Math.floor(time / SLOT_MS)
  return ((hashString(`${deviceId}|${slot}`) / 4294967295) * 2 - 1) * amplitude
}

export function acWatts(setTemp: number): number {
  return 600 + Math.max(0, 28 - setTemp) * 150
}

// 微波爐、熱水壺跟洗衣機一樣是「定時」家電：按下開始後跑一段固定時間，時間到自動停
export const MICROWAVE_DURATION_MS = 2 * 60 * 1000
export const KETTLE_DURATION_MS = 3 * 60 * 1000

const TIMED_DURATION_MS: Partial<Record<Device['kind'], number>> = {
  washer: WASH_DURATION_MS,
  microwave: MICROWAVE_DURATION_MS,
  kettle: KETTLE_DURATION_MS
}

// 冰箱的壓縮機：每 20 分鐘一輪，前 8 分鐘運轉。沒有事件也會自己切換，
// 所以跳電計算、歷史讀數都要另外加上這些切換時間點（intrinsicChangePoints）
export const FRIDGE_CYCLE_MS = 20 * 60 * 1000
export const FRIDGE_COMPRESSOR_MS = 8 * 60 * 1000
const FRIDGE_COMPRESSOR_WATTS = 130
const FRIDGE_IDLE_WATTS = 6

export function washerRunning(event: DeviceEvent | null, time: number): boolean {
  return timedRunning(WASH_DURATION_MS, event, time)
}

function timedRunning(duration: number, event: DeviceEvent | null, time: number): boolean {
  if (!event?.power_on || !event.started_at) return false
  const elapsed = time - Date.parse(event.started_at)
  return elapsed >= 0 && elapsed < duration
}

// 家電在這個時間點是不是「開著」：定時家電要在行程時間內；冰箱沒有任何事件時預設插著電
export function deviceIsOn(device: Device, event: DeviceEvent | null, time: number): boolean {
  const duration = TIMED_DURATION_MS[device.kind]
  if (duration !== undefined) return timedRunning(duration, event, time)
  if (device.kind === 'fridge') return event?.power_on ?? true
  return Boolean(event?.power_on)
}

function fridgeCompressorOn(time: number): boolean {
  return ((time % FRIDGE_CYCLE_MS) + FRIDGE_CYCLE_MS) % FRIDGE_CYCLE_MS < FRIDGE_COMPRESSOR_MS
}

export function readingFromEvent(device: Device, event: DeviceEvent | null, time: number): Reading {
  const base: Reading = {
    device_id: device.id,
    timestamp: new Date(time).toISOString(),
    power_watts: 0,
    water_liters: device.type === 'water' ? 0 : null,
    status: 'off',
    set_temp_c: null,
    wash_phase: null
  }

  // 跳電時系統寫的斷電事件代表「沒有電」：連待機電都沒有，一律 0W，直到復電時寫入新的事件
  if (event?.source === 'system' && !event.power_on) {
    return { ...base, set_temp_c: device.kind === 'air_conditioner' ? (event.set_temp_c ?? AC_DEFAULT_TEMP) : null }
  }

  if (device.kind === 'air_conditioner') {
    const setTemp = event?.set_temp_c ?? AC_DEFAULT_TEMP
    if (!event?.power_on) return { ...base, set_temp_c: setTemp }
    const sinceStart = event.started_at ? time - Date.parse(event.started_at) : Infinity
    const surge = sinceStart < AC_SURGE_MS ? 300 : 0
    return {
      ...base,
      status: 'on',
      set_temp_c: setTemp,
      power_watts: Math.round(acWatts(setTemp) + surge + noise(device.id, time, 30))
    }
  }

  if (device.kind === 'tv') {
    if (!event?.power_on) return base
    return { ...base, status: 'on', power_watts: Math.round(110 + noise(device.id, time, 6)) }
  }

  if (device.kind === 'fridge') {
    if (!deviceIsOn(device, event, time)) return base
    if (!fridgeCompressorOn(time)) return { ...base, status: 'on', power_watts: FRIDGE_IDLE_WATTS }
    return { ...base, status: 'running', power_watts: Math.round(FRIDGE_COMPRESSOR_WATTS + noise(device.id, time, 8)) }
  }

  if (device.kind === 'microwave') {
    // 不加熱時面板時鐘有一點待機電
    if (!deviceIsOn(device, event, time)) return { ...base, status: 'standby', power_watts: 2 }
    return { ...base, status: 'running', power_watts: Math.round(1200 + noise(device.id, time, 25)) }
  }

  if (device.kind === 'kettle') {
    if (!deviceIsOn(device, event, time)) return base
    return { ...base, status: 'running', power_watts: Math.round(1500 + noise(device.id, time, 20)) }
  }

  if (device.kind === 'light') {
    if (!event?.power_on) return base
    return { ...base, status: 'on', power_watts: 12 }
  }

  // washer
  if (!washerRunning(event, time)) return { ...base, status: 'standby', power_watts: 2 }
  const step = WASH_CYCLE[Math.floor((time - Date.parse(event!.started_at!)) / WASH_STEP_MS)]!
  return {
    ...base,
    status: 'running',
    power_watts: Math.round(step.watts + noise(device.id, time, 25)),
    water_liters: step.liters,
    wash_phase: step.phase
  }
}

// 事件本身之外，讀數也會「自己」改變的時間點：冷氣開機高峰結束、洗衣機每段行程切換與結束、
// 微波爐和熱水壺時間到自動停。
export function implicitChangePoints(device: Device, event: DeviceEvent): number[] {
  if (!event.power_on || !event.started_at) return []
  const start = Date.parse(event.started_at)
  if (device.kind === 'air_conditioner') return [start + AC_SURGE_MS]
  if (device.kind === 'washer') return WASH_CYCLE.map((_, i) => start + (i + 1) * WASH_STEP_MS)
  const duration = TIMED_DURATION_MS[device.kind]
  if (duration !== undefined) return [start + duration]
  return []
}

// 跟事件無關、家電自己週期性改變的時間點（目前只有冰箱的壓縮機），回傳 (from, to] 之間的
export function intrinsicChangePoints(device: Device, from: number, to: number): number[] {
  if (device.kind !== 'fridge') return []
  const points: number[] = []
  const firstCycle = Math.floor(from / FRIDGE_CYCLE_MS) * FRIDGE_CYCLE_MS
  for (let cycle = firstCycle; cycle <= to; cycle += FRIDGE_CYCLE_MS) {
    for (const t of [cycle, cycle + FRIDGE_COMPRESSOR_MS]) {
      if (t > from && t <= to) points.push(t)
    }
  }
  return points
}

// 把 [from, to] 之間的讀數算出來。events 依時間排序，第一筆可以早於 from
//（代表區間開始時家電的狀態）。取樣點 = 每 5 分鐘一點 + 每筆事件 + 行程切換點，
// 前端用階梯線畫，短暫的開關也不會因為取樣間隔被吃掉。
export function readingsBetween(device: Device, events: DeviceEvent[], from: number, to: number): Reading[] {
  const times = new Set<number>([from, to])
  for (let t = Math.ceil(from / SLOT_MS) * SLOT_MS; t < to; t += SLOT_MS) times.add(t)
  for (const event of events) {
    const at = Date.parse(event.timestamp)
    if (at >= from && at <= to) times.add(at)
    for (const t of implicitChangePoints(device, event)) {
      if (t >= from && t <= to) times.add(t)
    }
  }
  for (const t of intrinsicChangePoints(device, from, to)) times.add(t)

  const sorted = [...times].sort((a, b) => a - b)
  const readings: Reading[] = []
  let cursor = -1
  for (const t of sorted) {
    while (cursor + 1 < events.length && Date.parse(events[cursor + 1]!.timestamp) <= t) cursor++
    readings.push(readingFromEvent(device, cursor >= 0 ? events[cursor]! : null, t))
  }
  return readings
}
