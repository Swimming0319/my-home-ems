import type { DeviceEvent } from '#shared/types/smartRoom'

// GET /api/events/latest → { [deviceId]: 目前生效的那筆事件 | null }
// 前端拿到後自己用 readingFromEvent 每秒推算即時讀數，之後再靠 Realtime 推播的新事件更新
export default defineEventHandler(async (): Promise<Record<string, DeviceEvent | null>> => {
  const repo = useRepo()
  const now = new Date()
  // 前端載入目前狀態的入口，順便結算跳電：就算超載時沒人開著頁面，這時也會補上斷電事件
  await advanceBreaker(repo, now.getTime())
  const devices = await repo.listDevices()
  const events = await Promise.all(devices.map((device) => repo.latestEvent(device.id, now)))
  return Object.fromEntries(devices.map((device, i) => [device.id, events[i] ?? null]))
})
