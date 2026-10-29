import type { AlertLevel, Device, Reading } from '../types/smartRoom'

// 警示規則：前台家電提示、後台儀表板、（之後的）後端警示紀錄都用這一份，結果才會一致。

export const WARNING_RATIO = 0.8

// 全屋契約容量的預設值；實際值存在 house_settings 表，可在後台調整
export const DEFAULT_HOUSE_LIMIT_WATTS = 3000

// 後台可設定的範圍，前後端共用同一組驗證。
// 刻意寫成一個個數字常數而不是 { min, max } 物件：Nuxt 自動 import 的掃描器遇到同一行的物件常數，
// 會漏掉緊接在後面的那個 export（真的踩過，見 CLAUDE.md）
export const HOUSE_LIMIT_MIN = 500
export const HOUSE_LIMIT_MAX = 20000
export const DEVICE_THRESHOLD_MIN = 10
export const DEVICE_THRESHOLD_MAX = 10000

export const AC_TEMP_MIN = 20
export const AC_TEMP_MAX = 30
export const AC_DEFAULT_TEMP = 26

export function levelForWatts(watts: number, limit: number): AlertLevel {
  if (watts > limit) return 'alert'
  if (watts >= limit * WARNING_RATIO) return 'warning'
  return 'normal'
}

export function deviceAlertLevel(device: Device, reading: Reading | null): AlertLevel {
  return levelForWatts(reading?.power_watts ?? 0, device.power_threshold_watts)
}

export function houseAlertLevel(totalWatts: number, limit: number): AlertLevel {
  return levelForWatts(totalWatts, limit)
}
