import type { AdminSession } from '#shared/types/smartRoom'

export default defineEventHandler(async (event): Promise<AdminSession> => {
  if (!allowRequest('login', getRequestIP(event, { xForwardedFor: true }) ?? 'unknown', Date.now())) {
    throw createError({ statusCode: 429, statusMessage: '嘗試次數太多，請一分鐘後再試' })
  }
  if (!useRuntimeConfig(event).adminPassword) {
    throw createError({ statusCode: 503, statusMessage: '伺服器沒有設定管理密碼（NUXT_ADMIN_PASSWORD）' })
  }
  const body = await readBody<{ password?: unknown }>(event)
  const ok = typeof body?.password === 'string' && (await loginWithPassword(event, body.password))
  if (!ok) throw createError({ statusCode: 401, statusMessage: '密碼錯誤' })
  return adminSession(event)
})
