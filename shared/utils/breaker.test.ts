import { describe, expect, it } from 'vitest'
import type { DeviceEvent } from '../types/smartRoom'
import { BREAKER_GRACE_MS, findBreakerTrip, tripEvents, tripIsGuided } from './breaker'
import { readingFromEvent, WASH_STEP_MS } from './powerModel'
import { createMemoryRepo, SEED_DEVICES } from '../../server/utils/repo'
import { advanceBreaker, restorePower } from '../../server/utils/breaker'

const devices = SEED_DEVICES
const MIN = 60_000
const t0 = Date.parse('2026-10-01T00:00:00Z')
const iso = (t: number) => new Date(t).toISOString()

function on(device_id: string, at: number, extra: Partial<DeviceEvent> = {}): DeviceEvent {
  return { device_id, timestamp: iso(at), power_on: true, set_temp_c: null, started_at: iso(at), source: 'player', guided: false, ...extra }
}

// 冷氣 20°C（1800W，開機高峰 2100W）+ 洗衣機加熱段（1800W）一定超過 3000W
const acCold = on('ac', t0, { set_temp_c: 20 })
const washer = on('washer', t0)
const heatingStarts = t0 + 2 * WASH_STEP_MS

describe('tripIsGuided', () => {
  const tripAt = heatingStarts + BREAKER_GRACE_MS

  it('跳電當下開著的家電有一台是導覽中開的，就算導覽示範的跳電', () => {
    const guidedWasher = on('washer', t0, { guided: true })
    expect(tripIsGuided(devices, { ac: [acCold], washer: [guidedWasher] }, tripAt)).toBe(true)
    expect(tripEvents(devices, { ac: [acCold], washer: [guidedWasher] }, tripAt).every((e) => e.guided)).toBe(true)
  })

  it('沒有導覽中開的家電：一般跳電', () => {
    expect(tripIsGuided(devices, { ac: [acCold], washer: [washer] }, tripAt)).toBe(false)
    expect(tripEvents(devices, { ac: [acCold], washer: [washer] }, tripAt).some((e) => e.guided)).toBe(false)
  })

  it('導覽中開過、但跳電前已經關掉的家電不算', () => {
    const tvOn = on('tv', t0, { guided: true })
    const tvOff: DeviceEvent = { ...tvOn, timestamp: iso(t0 + MIN), power_on: false, started_at: null }
    expect(tripIsGuided(devices, { ac: [acCold], washer: [washer], tv: [tvOn, tvOff] }, tripAt)).toBe(false)
  })
})

describe('findBreakerTrip', () => {
  it('超過契約容量滿 10 秒就跳電，時間點精確到洗衣機進入加熱段後 10 秒', () => {
    const trip = findBreakerTrip(devices, { ac: [acCold], washer: [washer] }, t0, t0 + 30 * MIN, 3000)
    expect(trip).toBe(heatingStarts + BREAKER_GRACE_MS)
  })

  it('沒有超過就不跳電', () => {
    expect(findBreakerTrip(devices, { ac: [acCold], washer: [washer] }, t0, t0 + 30 * MIN, 5000)).toBeNull()
  })

  it('寬限時間還沒到就關掉家電，不會跳電', () => {
    const acOff: DeviceEvent = { ...acCold, timestamp: iso(heatingStarts + 5000), power_on: false, started_at: null }
    const trip = findBreakerTrip(devices, { ac: [acCold, acOff], washer: [washer] }, t0, t0 + 30 * MIN, 3000)
    expect(trip).toBeNull()
  })

  it('檢查時間還沒撐滿寬限時間，先不跳電', () => {
    expect(findBreakerTrip(devices, { ac: [acCold], washer: [washer] }, t0, heatingStarts + 5000, 3000)).toBeNull()
  })

  it('tripEvents 讓整間停電：每台家電都寫一筆斷電事件，保留冷氣的設定溫度', () => {
    const events = tripEvents(devices, { ac: [acCold], washer: [washer], tv: [] }, heatingStarts + BREAKER_GRACE_MS)
    expect(events.map((e) => e.device_id).sort()).toEqual(devices.map((d) => d.id).sort())
    expect(events.every((e) => e.source === 'system' && !e.power_on)).toBe(true)
    expect(events.find((e) => e.device_id === 'ac')?.set_temp_c).toBe(20)
  })

  it('停電期間連待機電都沒有', () => {
    const [outage] = tripEvents(devices.filter((d) => d.id === 'microwave'), {}, t0)
    expect(readingFromEvent(devices.find((d) => d.id === 'microwave')!, outage!, t0 + MIN)).toMatchObject({ status: 'off', power_watts: 0 })
  })
})

describe('advanceBreaker（記憶體模式）', () => {
  it('沒人在線時超載，下次檢查會把斷電事件補在正確的時間點，而且只補一次', async () => {
    const repo = createMemoryRepo()
    await repo.insertEvent(acCold)
    await repo.insertEvent(washer)

    const now = t0 + 60 * MIN
    expect(await advanceBreaker(repo, now)).toBe(heatingStarts + BREAKER_GRACE_MS)
    const acState = await repo.latestEvent('ac', new Date(now))
    expect(acState).toMatchObject({ power_on: false, source: 'system', timestamp: iso(heatingStarts + BREAKER_GRACE_MS) })

    expect(await advanceBreaker(repo, now + MIN)).toBeNull()
    expect((await repo.getSettings()).tripped_at).toBe(iso(heatingStarts + BREAKER_GRACE_MS))
  })

  it('跳電紀錄會帶著是不是導覽示範：同一次跳電只列一筆', async () => {
    const repo = createMemoryRepo()
    await repo.insertEvent(acCold)
    await repo.insertEvent(on('washer', t0, { guided: true }))
    const now = t0 + 60 * MIN
    await advanceBreaker(repo, now)
    expect(await repo.listTrips(new Date(t0), new Date(now))).toEqual([{ at: heatingStarts + BREAKER_GRACE_MS, guided: true }])
  })

  it('復電：冰箱、跳電前開著的燈自動恢復，其他家電維持關閉但回到待機', async () => {
    const repo = createMemoryRepo()
    await repo.insertEvent(on('light_living', t0 - MIN, { started_at: iso(t0 - MIN) }))
    await repo.insertEvent(acCold)
    await repo.insertEvent(washer)
    const now = t0 + 60 * MIN
    await advanceBreaker(repo, now)

    expect(await restorePower(repo, now, 'player')).toBe(true)
    expect((await repo.getSettings()).tripped_at).toBeNull()
    const state = async (id: string) => repo.latestEvent(id, new Date(now))
    expect(await state('fridge')).toMatchObject({ power_on: true, source: 'player' })
    expect(await state('light_living')).toMatchObject({ power_on: true })
    expect(await state('light_bedroom')).toMatchObject({ power_on: false })
    expect(await state('ac')).toMatchObject({ power_on: false, set_temp_c: 20 })
    const microwave = devices.find((d) => d.id === 'microwave')!
    expect(readingFromEvent(microwave, await state('microwave'), now + MIN)).toMatchObject({ status: 'standby', power_watts: 2 })

    // 已經有電時再按一次不會多寫事件
    expect(await restorePower(repo, now + MIN, 'player')).toBe(false)
  })

  it('改契約容量後，新的容量不會追溯套用到改之前的時段', async () => {
    const repo = createMemoryRepo()
    // 冷氣 20°C 單獨 1800W：在 3000W 的容量下不會跳電
    await repo.insertEvent(acCold)
    const changedAt = t0 + 60 * MIN
    expect(await advanceBreaker(repo, changedAt)).toBeNull()
    await repo.updateSettings({ house_limit_watts: 1000, breaker_settled_at: iso(changedAt), tripped_at: null })

    // 調低到 1000W 之後，從改的那一刻起算 10 秒才跳電，而不是追溯到冷氣開機那時
    expect(await advanceBreaker(repo, changedAt + 30_000)).toBe(changedAt + BREAKER_GRACE_MS)
  })
})
