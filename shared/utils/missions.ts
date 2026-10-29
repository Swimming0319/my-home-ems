import type { Device, Reading } from '../types/smartRoom'
import { energyKwh } from './energy'

// 每日小任務：全房間一起完成（房間是全站共用的），每天 0 點（瀏覽器時區）重新開始。
// 只用前端已經有的資料判斷：24 小時歷史讀數、跳電時間點
export const DAILY_KWH_GOAL = 10
export const AC_TEMP_GOAL = 26

export type MissionId = 'no_trip' | 'daily_kwh' | 'ac_temp'

export interface Mission {
  id: MissionId
  title: string
  // ok：到目前為止都有做到；failed：今天已經失敗了
  status: 'ok' | 'failed'
  detail: string
  // 有進度條的任務才有（0～1）
  progress?: number
}

export interface MissionInput {
  dayStart: number
  now: number
  devices: Device[]
  history: Record<string, Reading[]>
  // guided：新手導覽示範造成的跳電，不算任務失敗
  trips: { at: number; guided: boolean }[]
}

// [dayStart, now] 之間曾經生效過的讀數（包含 dayStart 當下生效、時間早於 dayStart 的那一筆）
function readingsSince(readings: Reading[], dayStart: number): Reading[] {
  const firstInside = readings.findIndex((r) => Date.parse(r.timestamp) > dayStart)
  if (firstInside === -1) return readings.slice(-1)
  return readings.slice(Math.max(0, firstInside - 1))
}

export function dailyMissions({ dayStart, now, devices, history, trips }: MissionInput): Mission[] {
  const today = trips.filter((trip) => trip.at >= dayStart && trip.at <= now)
  const tripsToday = today.filter((trip) => !trip.guided).length
  const guidedToday = today.length - tripsToday

  const kwh = devices.reduce((sum, device) => sum + energyKwh(history[device.id] ?? [], dayStart, now), 0)

  let coldest: number | null = null
  for (const device of devices.filter((d) => d.kind === 'air_conditioner')) {
    for (const reading of readingsSince(history[device.id] ?? [], dayStart)) {
      if (reading.status !== 'on' || reading.set_temp_c === null) continue
      coldest = coldest === null ? reading.set_temp_c : Math.min(coldest, reading.set_temp_c)
    }
  }
  const acOk = coldest === null || coldest >= AC_TEMP_GOAL

  return [
    {
      id: 'no_trip',
      title: '今天不要跳電',
      status: tripsToday === 0 ? 'ok' : 'failed',
      detail:
        tripsToday > 0
          ? `今天已經跳電 ${tripsToday} 次`
          : guidedToday > 0
            ? '到目前為止都沒有跳電（導覽示範的跳電不算）'
            : '到目前為止都沒有跳電'
    },
    {
      id: 'daily_kwh',
      title: `今天用電不超過 ${DAILY_KWH_GOAL} 度`,
      status: kwh <= DAILY_KWH_GOAL ? 'ok' : 'failed',
      detail: `已經用了 ${kwh.toFixed(1)} 度`,
      progress: Math.min(1, kwh / DAILY_KWH_GOAL)
    },
    {
      id: 'ac_temp',
      title: `冷氣都開 ${AC_TEMP_GOAL}°C 以上`,
      status: acOk ? 'ok' : 'failed',
      detail: coldest === null ? '今天還沒開冷氣' : acOk ? `最低開到 ${coldest}°C` : `曾經開到 ${coldest}°C`
    }
  ]
}

export function startOfLocalDay(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
