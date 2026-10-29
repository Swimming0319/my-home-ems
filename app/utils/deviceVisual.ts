import type { Device, DeviceStatus, Reading } from '#shared/types/smartRoom'

// 電器狀態 → 視覺層級，3D 場景、側欄卡片、圖表共用同一套判斷，顏色才會一致。
// 接近／超過閾值的判斷來自 shared/utils/alerts.ts，跟後端用的是同一份規則。
export type VisualLevel = 'off' | 'idle' | 'active' | 'warning' | 'alert'

export function visualLevel(device: Device, reading: Reading | null): VisualLevel {
  if (!reading || reading.status === 'off') return 'off'
  const alert = deviceAlertLevel(device, reading)
  if (alert !== 'normal') return alert
  if (reading.status === 'standby') return 'idle'
  return 'active'
}

// 要跟 app/assets/css/main.css 的 @theme 色票一致：3D 場景與 Chart.js 畫在 canvas 上，吃不到 CSS 變數
export const LEVEL_COLORS: Record<VisualLevel, string> = {
  off: '#5b6372',
  idle: '#8fa3bf',
  active: '#3ecf8e',
  warning: '#ff9f43',
  alert: '#ff4d4f'
}

export const STATUS_LABELS: Record<DeviceStatus, string> = {
  on: '開機',
  off: '關機',
  standby: '待機',
  running: '運轉中'
}

const timeFormat = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
const dateTimeFormat = new Intl.DateTimeFormat('zh-TW', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

export function formatTime(time: number): string {
  return timeFormat.format(time)
}

export function formatDateTime(time: number): string {
  return dateTimeFormat.format(time)
}
