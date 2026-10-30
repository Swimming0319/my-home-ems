import { describe, expect, it } from 'vitest'
import type { Device, DeviceEvent } from '../../shared/types/smartRoom'
import { KETTLE_DURATION_MS } from '../../shared/utils/powerModel'
import { SEED_DEVICES } from '../../server/utils/repo'
import { describeOthersBatch, describeOthersEvent } from './othersActivity'

const t0 = Date.parse('2026-10-30T10:00:00Z')
const iso = (t: number) => new Date(t).toISOString()
const device = (id: string): Device => SEED_DEVICES.find((d) => d.id === id)!
const ev = (deviceId: string, at: number, extra: Partial<DeviceEvent> = {}): DeviceEvent => ({
  device_id: deviceId,
  timestamp: iso(at),
  power_on: true,
  set_temp_c: null,
  started_at: iso(at),
  source: 'player',
  guided: false,
  ...extra
})

describe('別人操作家電的提示', () => {
  it('打開、關掉', () => {
    const on = ev('tv', t0)
    expect(describeOthersEvent({ device: device('tv'), previous: null, event: on })).toBe('有人打開了電視')
    const off = ev('tv', t0 + 1000, { power_on: false, started_at: null })
    expect(describeOthersEvent({ device: device('tv'), previous: on, event: off })).toBe('有人關掉了電視')
  })

  it('管理員遠端操作、調溫度', () => {
    const on = ev('ac', t0, { set_temp_c: 26, source: 'admin' })
    expect(describeOthersEvent({ device: device('ac'), previous: null, event: on })).toBe('管理員遠端打開了冷氣')
    const colder = ev('ac', t0 + 1000, { set_temp_c: 24, started_at: on.started_at })
    expect(describeOthersEvent({ device: device('ac'), previous: on, event: colder })).toBe('有人把冷氣調到 24°C')
  })

  it('定時家電用比較自然的說法；上一輪已經跑完時再按開始也算「開始」', () => {
    const first = ev('kettle', t0)
    const again = ev('kettle', t0 + KETTLE_DURATION_MS + 1000)
    expect(describeOthersEvent({ device: device('kettle'), previous: first, event: again })).toBe('有人開始煮開水')
  })

  it('跳電、自動復電這類系統事件不提示（各自有橫幅）', () => {
    const trip = ev('ac', t0, { power_on: false, started_at: null, source: 'system' })
    expect(describeOthersEvent({ device: device('ac'), previous: null, event: trip })).toBeNull()
    const auto = ev('fridge', t0, { source: 'auto' })
    expect(describeOthersEvent({ device: device('fridge'), previous: null, event: auto })).toBeNull()
  })

  it('同一個時間點好幾台家電的事件是復電，合併成一句', () => {
    const batch = ['fridge', 'ac', 'tv'].map((id) => ({ device: device(id), previous: null, event: ev(id, t0, { power_on: id === 'fridge' }) }))
    expect(describeOthersBatch(batch)).toBe('有人把電箱的總開關扳回去了')
    const remote = batch.map((item) => ({ ...item, event: { ...item.event, source: 'admin' as const } }))
    expect(describeOthersBatch(remote)).toBe('管理員遠端復電了')
  })
})
