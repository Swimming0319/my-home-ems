import type { BreakerTrip } from '#shared/types/smartRoom'

// GET /api/breaker/trips  過去 24 小時的每次跳電，前台「今天不要跳電」任務用（導覽示範的跳電不算）
export default defineEventHandler(async (): Promise<BreakerTrip[]> => {
  const repo = useRepo()
  const now = Date.now()
  await advanceBreaker(repo, now)
  const trips = await repo.listTrips(new Date(now - 24 * 60 * 60 * 1000), new Date(now))
  return trips.map((trip) => ({ at: new Date(trip.at).toISOString(), guided: trip.guided }))
})
