import type { BreakerCheckResult } from '#shared/types/smartRoom'

// 前端偵測到全屋超載、倒數結束時呼叫，讓跳電立刻結算並透過 Realtime 推播給所有人。
// 公開、可重複呼叫：跳電時間由伺服器依事件算出，跟誰、什麼時候呼叫無關
export default defineEventHandler(async (): Promise<BreakerCheckResult> => {
  const tripAt = await advanceBreaker(useRepo(), Date.now())
  return { tripped_at: tripAt === null ? null : new Date(tripAt).toISOString() }
})
