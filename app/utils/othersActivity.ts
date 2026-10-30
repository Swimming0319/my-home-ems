import type { Device, DeviceEvent } from '#shared/types/smartRoom'
import { deviceIsOn } from '#shared/utils/powerModel'

// 房間是全站共用的，但看不到其他人的角色：家電被別人開關時，畫面上只會看到它「自己」變了。
// Realtime 推播來的事件如果不是自己送出的，就用一句話說明是誰做了什麼。

export interface OthersEvent {
  device: Device
  // 收到這筆事件之前，這台家電生效的事件
  previous: DeviceEvent | null
  event: DeviceEvent
}

const TURN_ON: Partial<Record<Device['kind'], string>> = {
  washer: '啟動了洗衣機',
  microwave: '開始用微波爐加熱',
  kettle: '開始煮開水'
}

// 一筆事件 → 提示文字；系統寫的事件（跳電、自動復電，各自有橫幅）或看不出變化時回傳 null
export function describeOthersEvent({ device, previous, event }: OthersEvent): string | null {
  if (event.source !== 'player' && event.source !== 'admin') return null
  const who = event.source === 'admin' ? '管理員遠端' : '有人'
  const time = Date.parse(event.timestamp)
  // 定時家電跑完會自己停，但最後一筆事件還是「開」，要用 deviceIsOn 判斷收到這筆之前是不是真的開著
  const wasOn = deviceIsOn(device, previous, time)
  const isOn = deviceIsOn(device, event, time)
  if (!wasOn && isOn) return `${who}${TURN_ON[device.kind] ?? `打開了${device.name}`}`
  if (wasOn && !isOn) return `${who}關掉了${device.name}`
  if (event.set_temp_c !== null && event.set_temp_c !== previous?.set_temp_c) return `${who}把${device.name}調到 ${event.set_temp_c}°C`
  return null
}

// 同一個時間點收到好幾台家電的事件：只有復電會這樣（每台家電各寫一筆），合併成一句，不要一次跳 8 則
export function describeOthersBatch(batch: OthersEvent[]): string | null {
  if (batch.length === 0) return null
  if (batch.length === 1) return describeOthersEvent(batch[0]!)
  const source = batch[0]!.event.source
  if (source === 'admin') return '管理員遠端復電了'
  if (source === 'player') return '有人把電箱的總開關扳回去了'
  return null
}
