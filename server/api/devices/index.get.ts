import type { Device } from '#shared/types/smartRoom'

export default defineEventHandler(async (): Promise<Device[]> => {
  return useRepo().listDevices()
})
