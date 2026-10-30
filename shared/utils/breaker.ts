import type { Device, DeviceEvent } from '../types/smartRoom'
import { deviceIsOn, implicitChangePoints, intrinsicChangePoints, readingFromEvent, SLOT_MS } from './powerModel'

// 跳電規則：全屋用電「連續」超過契約容量這麼久就跳電。真實的斷路器也不是一超過就跳，
// 留一段時間讓玩家看到倒數、有機會關掉家電。
export const BREAKER_GRACE_MS = 10_000

// 停電這麼久沒人去扳總開關，就自動復電。真實的電箱不會自己恢復，這是為了全站共用的房間：
// 有人跳電後沒復電就離開，下一個訪客進來不會看到一間被丟著不管的暗房間
export const OUTAGE_AUTO_RESTORE_MS = 5 * 60 * 1000

function activeEvent(events: DeviceEvent[], time: number): DeviceEvent | null {
  let found: DeviceEvent | null = null
  for (const event of events) {
    if (Date.parse(event.timestamp) > time) break
    found = event
  }
  return found
}

export function totalWattsAt(devices: Device[], eventsByDevice: Record<string, DeviceEvent[]>, time: number): number {
  return devices.reduce(
    (sum, device) => sum + readingFromEvent(device, activeEvent(eventsByDevice[device.id] ?? [], time), time).power_watts,
    0
  )
}

// 找出 [from, to] 之間第一次該跳電的時間點，沒有就回傳 null。
// eventsByDevice 每台電器依時間排序，第一筆可以早於 from（代表 from 當下的狀態）。
// 全屋用電是分段常數：只會在事件、行程切換點、冰箱壓縮機切換、雜訊的 5 分鐘時間槽邊界改變，
// 所以只要逐段檢查，就能算出精確的跳電時間，不需要一直在背景輪詢。
export function findBreakerTrip(
  devices: Device[],
  eventsByDevice: Record<string, DeviceEvent[]>,
  from: number,
  to: number,
  limit: number,
  grace: number = BREAKER_GRACE_MS
): number | null {
  const times = new Set<number>([from])
  for (let t = Math.ceil(from / SLOT_MS) * SLOT_MS; t <= to; t += SLOT_MS) times.add(t)
  for (const device of devices) {
    for (const event of eventsByDevice[device.id] ?? []) {
      const at = Date.parse(event.timestamp)
      if (at > from && at <= to) times.add(at)
      for (const t of implicitChangePoints(device, event)) {
        if (t > from && t <= to) times.add(t)
      }
    }
    for (const t of intrinsicChangePoints(device, from, to)) times.add(t)
  }

  const sorted = [...times].sort((a, b) => a - b)
  let overSince: number | null = null
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!
    const isLast = i === sorted.length - 1
    const end = isLast ? to : sorted[i + 1]!
    if (totalWattsAt(devices, eventsByDevice, start) <= limit) {
      overSince = null
      continue
    }
    overSince ??= start
    const tripAt = overSince + grace
    // 這一段結束前就撐滿了寬限時間；剛好等於下一段起點的話交給下一段判斷（那時用電可能已經降下來）
    if (tripAt < end || (isLast && tripAt <= to)) return tripAt
  }
  return null
}

// 這次跳電是不是新手導覽示範造成的：跳電當下開著的家電裡，有一台是導覽中的人開的就算。
// 共用房間裡別人造成的超載剛好碰上導覽中的人開著電視，也會被算成導覽的，影響只是少算一次任務失敗
export function tripIsGuided(devices: Device[], eventsByDevice: Record<string, DeviceEvent[]>, at: number): boolean {
  return devices.some((device) => {
    const current = activeEvent(eventsByDevice[device.id] ?? [], at)
    return Boolean(current?.guided) && deviceIsOn(device, current, at)
  })
}

// 跳電時整間停電：每台家電都寫一筆 system 來源的斷電事件（包含原本就關著、只有待機電的），
// 停電期間的讀數才會全部是 0W
export function tripEvents(devices: Device[], eventsByDevice: Record<string, DeviceEvent[]>, at: number): DeviceEvent[] {
  const timestamp = new Date(at).toISOString()
  const guided = tripIsGuided(devices, eventsByDevice, at)
  return devices.map((device) => {
    const current = activeEvent(eventsByDevice[device.id] ?? [], at)
    return {
      device_id: device.id,
      timestamp,
      power_on: false,
      set_temp_c: current?.set_temp_c ?? null,
      started_at: null,
      source: 'system' as const,
      guided
    }
  })
}

// 復電時哪些家電會自己恢復：冰箱、電燈靠的是插頭／牆上開關，開關本來就開著，電一來就恢復；
// 冷氣、電視、微波爐、熱水壺、洗衣機是電子式的，停電後要重新按
export function resumesAfterOutage(device: Device, beforeTrip: DeviceEvent | null): boolean {
  if (device.kind === 'fridge') return beforeTrip?.power_on ?? true
  if (device.kind === 'light') return Boolean(beforeTrip?.power_on)
  return false
}
