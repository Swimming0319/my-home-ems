import type { Reading } from '#shared/types/smartRoom'

// GET /api/devices/:id/readings?range=24h
export default defineEventHandler(async (event): Promise<Reading[]> => {
  const id = getRouterParam(event, 'id') ?? ''
  const query = getQuery(event)
  const rangeMs = parseRange(typeof query.range === 'string' ? query.range : undefined)
  if (rangeMs === null) {
    throw createError({ statusCode: 400, statusMessage: 'range 格式應為數字加 m/h/d，例如 24h，最長 7d' })
  }

  const repo = useRepo()
  const device = await repo.getDevice(id)
  if (!device) {
    throw createError({ statusCode: 404, statusMessage: `找不到電器：${id}` })
  }

  const now = Date.now()
  const from = now - rangeMs
  // 區間內的事件之外，還要知道「區間開始那一刻」家電是什麼狀態——
  // 例如昨晚開了冷氣到現在都沒關，區間內就一筆事件都沒有
  const [initial, events] = await Promise.all([
    repo.latestEvent(device.id, new Date(from)),
    repo.listEvents(device.id, new Date(from), new Date(now))
  ])
  return readingsBetween(device, initial ? [initial, ...events] : events, from, now)
})
