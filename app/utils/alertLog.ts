import type { AlertLevel, Device, Reading } from '#shared/types/smartRoom'

// 找出 time 當下（含）最近的一筆讀數；讀數已按時間排序，用二分搜尋。
export function readingAtTime(list: Reading[], time: number): Reading | null {
  let lo = 0
  let hi = list.length - 1
  let found: Reading | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (Date.parse(list[mid]!.timestamp) <= time) {
      found = list[mid]!
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export interface AlertLogEntry {
  time: number
  // null 代表全屋總用電
  deviceId: string | null
  label: string
  level: Exclude<AlertLevel, 'normal'>
  watts: number
  limit: number
}

const RANK: Record<AlertLevel, number> = { normal: 0, warning: 1, alert: 2 }

// 只記「升級」的那一刻（正常 → 注意、注意 → 超過），一直維持在超過的狀態不會每個取樣點都記一筆
function crossings(points: { time: number; watts: number }[], limit: number) {
  const result: { time: number; watts: number; level: Exclude<AlertLevel, 'normal'> }[] = []
  let previous: AlertLevel = 'normal'
  for (const point of points) {
    const level = levelForWatts(point.watts, limit)
    if (level !== 'normal' && RANK[level] > RANK[previous]) result.push({ ...point, level })
    previous = level
  }
  return result
}

// 警示紀錄由歷史讀數推算，不另外存表：警示規則是純函式，同一段歷史永遠算出同樣的紀錄
// 用的是「目前」的閾值與契約容量；後台改過設定的話，舊的紀錄也會依新設定重算
export function buildAlertLog(devices: Device[], history: Record<string, Reading[]>, houseLimit: number): AlertLogEntry[] {
  const entries: AlertLogEntry[] = []

  for (const device of devices) {
    const points = (history[device.id] ?? []).map((r) => ({ time: Date.parse(r.timestamp), watts: r.power_watts }))
    for (const c of crossings(points, device.power_threshold_watts)) {
      entries.push({ ...c, deviceId: device.id, label: device.name, limit: device.power_threshold_watts })
    }
  }

  // 全屋：把每台電器的取樣時間點聯集起來，在每個時間點加總當下的讀數
  const times = [...new Set(devices.flatMap((d) => (history[d.id] ?? []).map((r) => Date.parse(r.timestamp))))].sort((a, b) => a - b)
  const totals = times.map((time) => ({
    time,
    watts: devices.reduce((sum, d) => sum + (readingAtTime(history[d.id] ?? [], time)?.power_watts ?? 0), 0)
  }))
  for (const c of crossings(totals, houseLimit)) {
    entries.push({ ...c, deviceId: null, label: '全屋', limit: houseLimit })
  }

  return entries.sort((a, b) => b.time - a.time)
}
