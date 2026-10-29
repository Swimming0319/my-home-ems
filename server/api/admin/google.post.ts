import type { AdminSession } from '#shared/types/smartRoom'

// POST /api/admin/google  { access_token }
// 瀏覽器透過 Supabase Auth 完成 Google 登入後呼叫：伺服器驗證 token、檢查允許名單，通過就發後台的 session cookie
export default defineEventHandler(async (event): Promise<AdminSession> => {
  if (!allowRequest('login', getRequestIP(event, { xForwardedFor: true }) ?? 'unknown', Date.now())) {
    throw createError({ statusCode: 429, statusMessage: '嘗試次數太多，請一分鐘後再試' })
  }
  const body = await readBody<{ access_token?: unknown }>(event)
  if (typeof body?.access_token !== 'string' || !body.access_token) {
    throw createError({ statusCode: 400, statusMessage: '缺少 access_token' })
  }
  const result = await loginWithGoogle(event, body.access_token)
  if (result === 'invalid') throw createError({ statusCode: 401, statusMessage: 'Google 登入已失效，請再試一次' })
  if (result === 'forbidden') throw createError({ statusCode: 403, statusMessage: '這個 Google 帳號沒有後台管理權限' })
  return adminSession(event)
})
