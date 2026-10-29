import type { HouseSettings } from '#shared/types/smartRoom'

// PATCH /api/settings  { house_limit_watts }（需要管理員登入）
export default defineEventHandler(async (event): Promise<HouseSettings> => {
  await requireAdmin(event)
  const body = await readBody<{ house_limit_watts?: unknown }>(event)
  const watts = body?.house_limit_watts
  if (typeof watts !== 'number' || !Number.isInteger(watts) || watts < HOUSE_LIMIT_MIN || watts > HOUSE_LIMIT_MAX) {
    throw createError({ statusCode: 400, statusMessage: `契約容量必須是 ${HOUSE_LIMIT_MIN}–${HOUSE_LIMIT_MAX} 之間的整數` })
  }
  const repo = useRepo()
  const now = Date.now()
  // 先用舊的容量把跳電結算到現在，新的容量從這一刻起算——調低容量時就算現在已經超載，
  // 也會從現在開始重新倒數，不會追溯成「早就該跳電了」
  await advanceBreaker(repo, now)
  const current = await repo.getSettings()
  const saved = await repo.updateSettings({ ...current, house_limit_watts: watts, breaker_settled_at: new Date(now).toISOString() })
  return { house_limit_watts: saved.house_limit_watts, tripped_at: saved.tripped_at }
})
