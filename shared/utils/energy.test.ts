import { describe, expect, it } from 'vitest'
import type { Reading } from '../types/smartRoom'
import { energyKwh, isSummer, monthlyBill } from './energy'

const HOUR = 60 * 60 * 1000
const t0 = Date.parse('2026-10-01T00:00:00Z')
const reading = (at: number, watts: number): Reading => ({
  device_id: 'x',
  timestamp: new Date(at).toISOString(),
  power_watts: watts,
  water_liters: null,
  status: watts > 0 ? 'on' : 'off',
  set_temp_c: null,
  wash_phase: null
})

describe('monthlyBill（累進電價）', () => {
  it('120 度以下每度 1.78 元', () => {
    expect(monthlyBill(100, false)).toBeCloseTo(178)
  })

  it('超過的部分依級距累進，夏月比較貴', () => {
    // 120 × 1.78 + 210 × 2.55 + 170 × 3.80 + 200 × 5.14（遠見的試算範例）
    expect(monthlyBill(700, true)).toBeCloseTo(2423.1)
    expect(monthlyBill(700, false)).toBeLessThan(monthlyBill(700, true))
  })

  it('0 度就是 0 元', () => {
    expect(monthlyBill(0, true)).toBe(0)
  })
})

describe('isSummer', () => {
  it('6/1～9/30 是夏月', () => {
    expect(isSummer(new Date(2026, 5, 1))).toBe(true)
    expect(isSummer(new Date(2026, 8, 30))).toBe(true)
    expect(isSummer(new Date(2026, 9, 1))).toBe(false)
  })
})

describe('energyKwh', () => {
  it('階梯積分：1000W 一小時是 1 度', () => {
    expect(energyKwh([reading(t0, 1000), reading(t0 + HOUR, 0)], t0, t0 + 2 * HOUR)).toBeCloseTo(1)
  })

  it('只算區間內的部分，最後一筆延續到區間結束', () => {
    const readings = [reading(t0, 500), reading(t0 + HOUR, 2000)]
    // 前半小時 500W 不算，後半小時 500W + 一小時 2000W
    expect(energyKwh(readings, t0 + HOUR / 2, t0 + 2 * HOUR)).toBeCloseTo(0.25 + 2)
  })
})
