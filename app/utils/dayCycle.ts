// 日夜循環：跟著瀏覽器的本地時間（台灣大約 5:30 天亮、18:00 天黑），晚上房間變暗、要開燈。
// 日出、日落各有一小時的過渡，天空顏色經過橘紅色的晨昏
const SUNRISE_START = 5.25
const SUNRISE_END = 6.5
const SUNSET_START = 17.25
const SUNSET_END = 18.5

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export interface DayCycle {
  // 0 是深夜、1 是白天
  daylight: number
  // 晨昏的程度：日出日落過渡的正中間是 1，天空偏橘紅
  twilight: number
  label: '白天' | '傍晚' | '晚上' | '清晨'
  icon: string
}

export function dayCycle(hour: number): DayCycle {
  const h = ((hour % 24) + 24) % 24
  const daylight = h < 12 ? smoothstep(SUNRISE_START, SUNRISE_END, h) : 1 - smoothstep(SUNSET_START, SUNSET_END, h)
  const twilight = 1 - Math.abs(daylight * 2 - 1)
  const morning = h < 12
  let label: DayCycle['label'] = '白天'
  if (daylight < 0.05) label = '晚上'
  else if (daylight < 0.95) label = morning ? '清晨' : '傍晚'
  return { daylight, twilight, label, icon: label === '白天' ? '☀️' : label === '晚上' ? '🌙' : '🌅' }
}

// 0～24 的小數小時
export function hourOf(time: number): number {
  const date = new Date(time)
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
}
