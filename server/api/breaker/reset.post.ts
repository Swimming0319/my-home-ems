import type { BreakerResetResult, CommandSource } from '#shared/types/smartRoom'

// POST /api/breaker/reset  { source: 'player' | 'admin' }
// 復電：前台玩家走到電箱扳回總開關，或後台遠端復電（需要登入）
export default defineEventHandler(async (event): Promise<BreakerResetResult> => {
  if (!allowRequest('command', getRequestIP(event, { xForwardedFor: true }) ?? 'unknown', Date.now())) {
    throw createError({ statusCode: 429, statusMessage: '操作太頻繁，請稍後再試' })
  }
  const body = await readBody<{ source?: unknown }>(event)
  const source = body?.source
  if (source !== 'player' && source !== 'admin') {
    throw createError({ statusCode: 400, statusMessage: 'source 必須是 player / admin' })
  }
  if (source === 'admin') await requireAdmin(event)
  const restored = await restorePower(useRepo(), Date.now(), source as CommandSource)
  return { restored }
})
