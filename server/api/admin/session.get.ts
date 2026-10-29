import type { AdminSession } from '#shared/types/smartRoom'

export default defineEventHandler((event): Promise<AdminSession> => adminSession(event))
