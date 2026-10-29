import type { Device } from '#shared/types/smartRoom'

// PATCH /api/devices/:id  { power_threshold_watts }（需要管理員登入）
export default defineEventHandler(async (event): Promise<Device> => {
  await requireAdmin(event)
  const body = await readBody<{ power_threshold_watts?: unknown }>(event)
  const watts = body?.power_threshold_watts
  if (typeof watts !== 'number' || !Number.isInteger(watts) || watts < DEVICE_THRESHOLD_MIN || watts > DEVICE_THRESHOLD_MAX) {
    throw createError({ statusCode: 400, statusMessage: `閾值必須是 ${DEVICE_THRESHOLD_MIN}–${DEVICE_THRESHOLD_MAX} 之間的整數` })
  }
  const device = await useRepo().updateDeviceThreshold(getRouterParam(event, 'id') ?? '', watts)
  if (!device) throw createError({ statusCode: 404, statusMessage: '找不到電器' })
  return device
})
