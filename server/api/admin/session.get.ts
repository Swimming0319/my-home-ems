import type { AdminSession } from '#shared/types/smartRoom'

export default defineEventHandler(async (event): Promise<AdminSession> => {
  return { authenticated: await isAdmin(event), passwordRequired: passwordRequired(event) }
})
