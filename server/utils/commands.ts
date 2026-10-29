import type { Device, DeviceCommand, DeviceEvent } from '#shared/types/smartRoom'
import { AC_DEFAULT_TEMP, AC_TEMP_MAX, AC_TEMP_MIN } from '#shared/utils/alerts'
import { deviceIsOn } from '#shared/utils/powerModel'

export class CommandError extends Error {}

// 把指令套用到目前狀態上，算出下一筆事件；狀態沒有改變（例如已經開機又按開機）回傳 null，
// 呼叫端就不寫入，避免事件表被重複點擊灌爆。純函式，方便測試。
export function applyCommand(
  device: Device,
  current: DeviceEvent | null,
  command: DeviceCommand,
  now: number
): DeviceEvent | null {
  const timestamp = new Date(now).toISOString()
  const setTemp = current?.set_temp_c ?? (device.kind === 'air_conditioner' ? AC_DEFAULT_TEMP : null)
  const isOn = deviceIsOn(device, current, now)
  const next = (patch: Partial<DeviceEvent>): DeviceEvent => ({
    device_id: device.id,
    timestamp,
    power_on: isOn,
    set_temp_c: setTemp,
    started_at: isOn ? (current?.started_at ?? null) : null,
    source: command.source,
    guided: command.guided ?? false,
    ...patch
  })

  switch (command.action) {
    case 'power_on':
      return isOn ? null : next({ power_on: true, started_at: timestamp })
    case 'power_off':
      return isOn ? next({ power_on: false, started_at: null }) : null
    case 'set_temp': {
      if (device.kind !== 'air_conditioner') throw new CommandError(`${device.name}不能設定溫度`)
      const temp = command.set_temp_c
      if (typeof temp !== 'number' || !Number.isInteger(temp) || temp < AC_TEMP_MIN || temp > AC_TEMP_MAX) {
        throw new CommandError(`溫度必須是 ${AC_TEMP_MIN}–${AC_TEMP_MAX} 之間的整數`)
      }
      return temp === setTemp ? null : next({ set_temp_c: temp })
    }
  }
}

const ACTIONS = new Set(['power_on', 'power_off', 'set_temp'])
const SOURCES = new Set(['player', 'admin'])

export function parseCommand(body: unknown): DeviceCommand {
  if (typeof body !== 'object' || body === null) throw new CommandError('請求內容必須是 JSON 物件')
  const { action, set_temp_c, source, guided } = body as Record<string, unknown>
  if (typeof action !== 'string' || !ACTIONS.has(action)) throw new CommandError('action 必須是 power_on / power_off / set_temp')
  if (typeof source !== 'string' || !SOURCES.has(source)) throw new CommandError('source 必須是 player / admin')
  if (set_temp_c !== undefined && typeof set_temp_c !== 'number') throw new CommandError('set_temp_c 必須是數字')
  if (guided !== undefined && typeof guided !== 'boolean') throw new CommandError('guided 必須是 true / false')
  return { action: action as DeviceCommand['action'], source: source as DeviceCommand['source'], set_temp_c, guided }
}
