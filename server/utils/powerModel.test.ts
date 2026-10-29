import { describe, expect, it } from 'vitest'
import type { DeviceCommand, DeviceEvent } from '#shared/types/smartRoom'
import { DEFAULT_HOUSE_LIMIT_WATTS, deviceAlertLevel, houseAlertLevel } from '#shared/utils/alerts'
import { applyCommand, CommandError, parseCommand } from './commands'
import {
  FRIDGE_COMPRESSOR_MS,
  FRIDGE_CYCLE_MS,
  KETTLE_DURATION_MS,
  MICROWAVE_DURATION_MS,
  readingFromEvent,
  readingsBetween,
  SLOT_MS,
  WASH_DURATION_MS,
  WASH_STEP_MS
} from '#shared/utils/powerModel'
import { parseRange } from './range'
import { createMemoryRepo, SEED_DEVICES } from './repo'

const byId = (id: string) => SEED_DEVICES.find((d) => d.id === id)!
const [ac, tv, washer, fridge, microwave, kettle, light] = ['ac', 'tv', 'washer', 'fridge', 'microwave', 'kettle', 'light_living'].map(byId) as [
  (typeof SEED_DEVICES)[0],
  (typeof SEED_DEVICES)[0],
  (typeof SEED_DEVICES)[0],
  (typeof SEED_DEVICES)[0],
  (typeof SEED_DEVICES)[0],
  (typeof SEED_DEVICES)[0],
  (typeof SEED_DEVICES)[0]
]
const MIN = 60_000
const t0 = Date.parse('2026-10-01T00:00:00Z')

const player = (action: DeviceCommand['action'], set_temp_c?: number): DeviceCommand => ({ action, set_temp_c, source: 'player' })

describe('readingFromEvent', () => {
  it('沒有任何事件時：冷氣、電視關機 0W，洗衣機待機 2W', () => {
    expect(readingFromEvent(ac, null, t0)).toMatchObject({ status: 'off', power_watts: 0, set_temp_c: 26 })
    expect(readingFromEvent(tv, null, t0)).toMatchObject({ status: 'off', power_watts: 0, water_liters: null })
    expect(readingFromEvent(washer, null, t0)).toMatchObject({ status: 'standby', power_watts: 2, water_liters: 0 })
  })

  it('冷氣：開機前 15 分鐘有高峰，設定溫度越低越耗電', () => {
    const on = applyCommand(ac, null, player('power_on'), t0)!
    const surge = readingFromEvent(ac, on, t0 + 5 * MIN).power_watts
    const steady = readingFromEvent(ac, on, t0 + 30 * MIN).power_watts
    expect(surge - steady).toBeGreaterThan(200)

    const colder = applyCommand(ac, on, player('set_temp', 22), t0 + 30 * MIN)!
    expect(readingFromEvent(ac, colder, t0 + 40 * MIN).power_watts).toBeGreaterThan(steady + 400)
  })

  it('洗衣機：一輪 60 分鐘，加熱段超過閾值、進水段用水，結束後自動回到待機', () => {
    const start = applyCommand(washer, null, player('power_on'), t0)!
    expect(readingFromEvent(washer, start, t0 + 1 * MIN)).toMatchObject({ status: 'running', water_liters: 15, wash_phase: 'fill' })
    expect(readingFromEvent(washer, start, t0 + 2 * WASH_STEP_MS + MIN).power_watts).toBeGreaterThan(washer.power_threshold_watts)
    expect(readingFromEvent(washer, start, t0 + WASH_DURATION_MS)).toMatchObject({ status: 'standby', power_watts: 2 })
  })

  it('冰箱：沒有任何事件也插著電，壓縮機每 20 分鐘運轉 8 分鐘；拔掉電源就是 0W', () => {
    const cycle = Math.ceil(t0 / FRIDGE_CYCLE_MS) * FRIDGE_CYCLE_MS
    expect(readingFromEvent(fridge, null, cycle + MIN)).toMatchObject({ status: 'running' })
    expect(readingFromEvent(fridge, null, cycle + MIN).power_watts).toBeGreaterThan(100)
    expect(readingFromEvent(fridge, null, cycle + FRIDGE_COMPRESSOR_MS + MIN)).toMatchObject({ status: 'on', power_watts: 6 })
    const off = applyCommand(fridge, null, player('power_off'), cycle)!
    expect(readingFromEvent(fridge, off, cycle + MIN)).toMatchObject({ status: 'off', power_watts: 0 })
  })

  it('冰箱的壓縮機切換點會出現在歷史讀數裡', () => {
    const cycle = Math.ceil(t0 / FRIDGE_CYCLE_MS) * FRIDGE_CYCLE_MS
    const times = readingsBetween(fridge, [], cycle, cycle + FRIDGE_CYCLE_MS).map((r) => Date.parse(r.timestamp))
    expect(times).toContain(cycle + FRIDGE_COMPRESSOR_MS)
  })

  it('微波爐、熱水壺：按下開始後跑固定時間，時間到自動停', () => {
    const heat = applyCommand(microwave, null, player('power_on'), t0)!
    expect(readingFromEvent(microwave, heat, t0 + MIN)).toMatchObject({ status: 'running' })
    expect(readingFromEvent(microwave, heat, t0 + MICROWAVE_DURATION_MS)).toMatchObject({ status: 'standby', power_watts: 2 })
    const boil = applyCommand(kettle, null, player('power_on'), t0)!
    expect(readingFromEvent(kettle, boil, t0 + MIN).power_watts).toBeGreaterThan(1400)
    expect(readingFromEvent(kettle, boil, t0 + KETTLE_DURATION_MS)).toMatchObject({ status: 'off', power_watts: 0 })
    // 時間到之後再按開始，可以再跑一次
    expect(applyCommand(kettle, boil, player('power_on'), t0 + KETTLE_DURATION_MS)).not.toBeNull()
  })

  it('電燈：開燈 12W', () => {
    const on = applyCommand(light, null, player('power_on'), t0)!
    expect(readingFromEvent(light, on, t0 + MIN)).toMatchObject({ status: 'on', power_watts: 12 })
  })

  it('同一個時間點重算結果完全相同', () => {
    const on = applyCommand(tv, null, player('power_on'), t0)!
    expect(readingFromEvent(tv, on, t0 + 7 * MIN)).toEqual(readingFromEvent(tv, on, t0 + 7 * MIN))
  })
})

describe('readingsBetween', () => {
  it('每 5 分鐘一點，加上事件發生的確切時間', () => {
    const on = applyCommand(tv, null, player('power_on'), t0 + 12 * MIN)!
    const off = applyCommand(tv, on, player('power_off'), t0 + 14 * MIN)!
    const readings = readingsBetween(tv, [on, off], t0, t0 + 30 * MIN)
    const times = readings.map((r) => (Date.parse(r.timestamp) - t0) / MIN)
    expect(times).toEqual([0, 5, 10, 12, 14, 15, 20, 25, 30])
    // 只開了 2 分鐘的電視不會因為取樣間隔被吃掉
    expect(readings.find((r) => r.timestamp === on.timestamp)?.status).toBe('on')
    expect(readings.find((r) => r.timestamp === off.timestamp)?.status).toBe('off')
  })

  it('區間開始前的事件決定開頭的狀態', () => {
    const on = applyCommand(ac, null, player('power_on'), t0 - 3 * 60 * MIN)!
    const readings = readingsBetween(ac, [on], t0, t0 + 10 * MIN)
    expect(readings.every((r) => r.status === 'on')).toBe(true)
  })

  it('洗衣機每段行程切換都有取樣點', () => {
    const start = applyCommand(washer, null, player('power_on'), t0 + 2 * MIN)!
    const readings = readingsBetween(washer, [start], t0, t0 + 90 * MIN)
    const times = new Set(readings.map((r) => Date.parse(r.timestamp)))
    for (let i = 1; i <= 12; i++) expect(times.has(t0 + 2 * MIN + i * WASH_STEP_MS)).toBe(true)
    expect(readings.at(-1)!.status).toBe('standby')
    expect(readings.filter((r) => (Date.parse(r.timestamp) - t0) % SLOT_MS === 0).length).toBe(19)
  })
})

describe('applyCommand', () => {
  it('重複的指令不產生新事件', () => {
    const on = applyCommand(tv, null, player('power_on'), t0)!
    expect(applyCommand(tv, on, player('power_on'), t0 + MIN)).toBeNull()
    expect(applyCommand(tv, null, player('power_off'), t0)).toBeNull()
    expect(applyCommand(ac, null, player('set_temp', 26), t0)).toBeNull()
  })

  it('冷氣調溫度保留開機時間，關機時也能先設好溫度', () => {
    const on = applyCommand(ac, null, player('power_on'), t0)!
    const colder = applyCommand(ac, on, player('set_temp', 24), t0 + 20 * MIN)!
    expect(colder).toMatchObject({ power_on: true, set_temp_c: 24, started_at: on.started_at })

    const presetWhileOff = applyCommand(ac, null, player('set_temp', 22), t0)!
    expect(presetWhileOff).toMatchObject({ power_on: false, set_temp_c: 22 })
  })

  it('洗衣機洗完之後可以再啟動新的一輪', () => {
    const first = applyCommand(washer, null, player('power_on'), t0)!
    expect(applyCommand(washer, first, player('power_on'), t0 + 10 * MIN)).toBeNull()
    const second = applyCommand(washer, first, player('power_on'), t0 + WASH_DURATION_MS + MIN)!
    expect(second.started_at).toBe(new Date(t0 + WASH_DURATION_MS + MIN).toISOString())
    expect(applyCommand(washer, first, player('power_off'), t0 + WASH_DURATION_MS + MIN)).toBeNull()
  })

  it.each([
    [ac, 19],
    [ac, 31],
    [ac, 24.5],
    [tv, 24]
  ])('拒絕不合法的溫度設定 %#', (device, temp) => {
    expect(() => applyCommand(device, null, player('set_temp', temp), t0)).toThrow(CommandError)
  })

  it('parseCommand 驗證請求內容', () => {
    expect(parseCommand({ action: 'power_on', source: 'admin' })).toEqual({ action: 'power_on', source: 'admin', set_temp_c: undefined })
    expect(() => parseCommand({ action: 'explode', source: 'player' })).toThrow(CommandError)
    expect(() => parseCommand({ action: 'power_on', source: 'system' })).toThrow(CommandError)
    expect(() => parseCommand(null)).toThrow(CommandError)
    expect(parseCommand({ action: 'power_on', source: 'player', guided: true }).guided).toBe(true)
    expect(() => parseCommand({ action: 'power_on', source: 'player', guided: 'yes' })).toThrow(CommandError)
  })

  it('導覽中送出的指令，事件標記 guided', () => {
    const event = applyCommand(ac, null, { action: 'power_on', source: 'player', guided: true }, t0)
    expect(event?.guided).toBe(true)
    expect(applyCommand(ac, null, { action: 'power_on', source: 'player' }, t0)?.guided).toBe(false)
  })
})

describe('警示規則', () => {
  it('單台家電：80% 注意、超過閾值警示', () => {
    const at = (watts: number) => ({ ...readingFromEvent(ac, null, t0), power_watts: watts })
    expect(deviceAlertLevel(ac, at(1000))).toBe('normal')
    expect(deviceAlertLevel(ac, at(1040))).toBe('warning')
    expect(deviceAlertLevel(ac, at(1301))).toBe('alert')
    expect(deviceAlertLevel(ac, null)).toBe('normal')
  })

  it('全屋：冷氣 22°C + 洗衣機加熱會超過契約容量', () => {
    const acOn = applyCommand(ac, applyCommand(ac, null, player('set_temp', 22), t0), player('power_on'), t0)!
    const wash = applyCommand(washer, null, player('power_on'), t0)!
    const at = t0 + 2 * WASH_STEP_MS + 30 * MIN - 20 * MIN
    const total = readingFromEvent(ac, acOn, at).power_watts + readingFromEvent(washer, wash, at).power_watts
    expect(houseAlertLevel(total, DEFAULT_HOUSE_LIMIT_WATTS)).toBe('alert')
    expect(houseAlertLevel(2500, DEFAULT_HOUSE_LIMIT_WATTS)).toBe('warning')
  })
})

describe('parseRange', () => {
  it.each([
    ['24h', 24 * 60 * MIN],
    ['90m', 90 * MIN],
    ['7d', 7 * 24 * 60 * MIN],
    [undefined, 24 * 60 * MIN]
  ])('%s', (input, expected) => {
    expect(parseRange(input)).toBe(expected)
  })

  it.each(['8d', '0h', '24', 'h', '1w', '-1h'])('拒絕 %s', (input) => {
    expect(parseRange(input)).toBeNull()
  })
})

describe('記憶體模式 repo', () => {
  it('latestEvent 取某時間點當下的狀態，listEvents 取 (from, to]', async () => {
    const repo = createMemoryRepo()
    const events: DeviceEvent[] = [
      applyCommand(tv, null, player('power_on'), t0)!,
      { ...applyCommand(tv, null, player('power_on'), t0)!, power_on: false, timestamp: new Date(t0 + 10 * MIN).toISOString() }
    ]
    // 故意反過來寫入，確認內部有維持時間排序
    await repo.insertEvent(events[1]!)
    await repo.insertEvent(events[0]!)
    expect(await repo.latestEvent('tv', new Date(t0 + 5 * MIN))).toEqual(events[0])
    expect(await repo.latestEvent('tv', new Date(t0 - MIN))).toBeNull()
    expect(await repo.listEvents('tv', new Date(t0), new Date(t0 + 10 * MIN))).toEqual([events[1]])
  })
})
