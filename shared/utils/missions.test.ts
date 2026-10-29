import { describe, expect, it } from 'vitest'
import type { Device, Reading } from '../types/smartRoom'
import { dailyMissions } from './missions'

const HOUR = 60 * 60 * 1000
const dayStart = Date.parse('2026-10-28T00:00:00+08:00')
const ac: Device = { id: 'ac', name: '冷氣', kind: 'air_conditioner', type: 'electricity', room_position: { x: 0, y: 0, z: 0, rotation: 0 }, power_threshold_watts: 1300 }
const reading = (at: number, watts: number, setTemp: number | null = null): Reading => ({
  device_id: 'ac',
  timestamp: new Date(at).toISOString(),
  power_watts: watts,
  water_liters: null,
  status: watts > 0 ? 'on' : 'off',
  set_temp_c: setTemp,
  wash_phase: null
})
const byId = (missions: ReturnType<typeof dailyMissions>) => Object.fromEntries(missions.map((m) => [m.id, m]))

describe('dailyMissions', () => {
  it('什麼都沒開：三個任務都達成中', () => {
    const m = byId(dailyMissions({ dayStart, now: dayStart + 5 * HOUR, devices: [ac], history: {}, trips: [] }))
    expect(m.no_trip!.status).toBe('ok')
    expect(m.daily_kwh!.status).toBe('ok')
    expect(m.ac_temp!.detail).toBe('今天還沒開冷氣')
  })

  it('昨天的跳電不算，今天的才算', () => {
    const m = byId(dailyMissions({ dayStart, now: dayStart + 5 * HOUR, devices: [ac], history: {}, trips: [{ at: dayStart - HOUR, guided: false }, { at: dayStart + HOUR, guided: false }] }))
    expect(m.no_trip).toMatchObject({ status: 'failed', detail: '今天已經跳電 1 次' })
  })

  it('導覽示範的跳電不算任務失敗', () => {
    const m = byId(dailyMissions({ dayStart, now: dayStart + 5 * HOUR, devices: [ac], history: {}, trips: [{ at: dayStart + HOUR, guided: true }] }))
    expect(m.no_trip).toMatchObject({ status: 'ok', detail: '到目前為止都沒有跳電（導覽示範的跳電不算）' })
  })

  it('冷氣開 1800W 超過 6 小時就超過 10 度', () => {
    const history = { ac: [reading(dayStart, 1800, 20)] }
    const m = byId(dailyMissions({ dayStart, now: dayStart + 6 * HOUR, devices: [ac], history, trips: [] }))
    expect(m.daily_kwh!.status).toBe('failed')
    expect(m.ac_temp).toMatchObject({ status: 'failed', detail: '曾經開到 20°C' })
  })

  it('昨晚開到今天的冷氣也算進來；關機時的設定溫度不算', () => {
    const history = { ac: [reading(dayStart - HOUR, 900, 27), reading(dayStart + HOUR, 0, 22)] }
    const m = byId(dailyMissions({ dayStart, now: dayStart + 2 * HOUR, devices: [ac], history, trips: [] }))
    expect(m.ac_temp).toMatchObject({ status: 'ok', detail: '最低開到 27°C' })
    expect(m.daily_kwh!.detail).toBe('已經用了 0.9 度')
  })
})
