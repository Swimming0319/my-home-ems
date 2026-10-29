import type { HouseSettings } from '#shared/types/smartRoom'

export default defineEventHandler(async (): Promise<HouseSettings> => {
  const repo = useRepo()
  // 先結算跳電：輪詢模式的前端靠這支 API 知道「現在是不是停電中」
  await advanceBreaker(repo, Date.now())
  const { house_limit_watts, tripped_at } = await repo.getSettings()
  return { house_limit_watts, tripped_at }
})
