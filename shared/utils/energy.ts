import type { Reading } from '../types/smartRoom'

// 台電住宅「表燈非時間電價」（累進電價），2025/10/1 調整後的費率，2026 年沿用。
// 來源：商業周刊、遠見、電費喵整理的台電公告（規劃文件「用電數字的由來」）。
// 級距以「每月」度數計；實際帳單兩個月一期，級距也會加倍，這裡一律換算成一個月。
// 寫成陣列而不是 export 物件常數：Nuxt 自動 import 的掃描器會漏掉物件常數後面的 export（見 CLAUDE.md）
const TARIFF_TIERS: { upTo: number; summer: number; nonSummer: number }[] = [
  { upTo: 120, summer: 1.78, nonSummer: 1.78 },
  { upTo: 330, summer: 2.55, nonSummer: 2.26 },
  { upTo: 500, summer: 3.8, nonSummer: 3.13 },
  { upTo: 700, summer: 5.14, nonSummer: 4.24 },
  { upTo: 1000, summer: 6.44, nonSummer: 5.27 },
  { upTo: Infinity, summer: 8.86, nonSummer: 7.03 }
]

export const DAYS_PER_MONTH = 30
const HOUR_MS = 60 * 60 * 1000

// 夏月：6/1～9/30（住宅用戶）
export function isSummer(date: Date): boolean {
  const month = date.getMonth() + 1
  return month >= 6 && month <= 9
}

// 一個月用了 kwh 度，依累進電價算出電費（元）
export function monthlyBill(kwh: number, summer: boolean): number {
  let bill = 0
  let lower = 0
  for (const tier of TARIFF_TIERS) {
    if (kwh <= lower) break
    const units = Math.min(kwh, tier.upTo) - lower
    bill += units * (summer ? tier.summer : tier.nonSummer)
    lower = tier.upTo
  }
  return bill
}

// 讀數是階梯函數（每筆讀數一直維持到下一筆），把 [from, to] 之間的用電量積分成度數（kWh）。
// 最後一筆讀數延續到 to：歷史資料只抓到上次更新的時間點，之後的狀態跟最後一筆一樣
export function energyKwh(readings: Reading[], from: number, to: number): number {
  let wattMs = 0
  for (let i = 0; i < readings.length; i++) {
    const start = Math.max(from, Date.parse(readings[i]!.timestamp))
    const end = Math.min(to, i + 1 < readings.length ? Date.parse(readings[i + 1]!.timestamp) : to)
    if (end > start) wattMs += readings[i]!.power_watts * (end - start)
  }
  return wattMs / 1000 / HOUR_MS
}
