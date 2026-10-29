import { useDevicesStore } from '~/stores/devices'

// 目前的小時（0～24 小數），給日夜循環用。網址加 ?hour=21.5 可以固定在某個時間，方便預覽晚上的樣子
export function useDayHour() {
  const store = useDevicesStore()
  const route = useRoute()
  return computed<number>(() => {
    const forced = Number(route.query.hour)
    return route.query.hour !== undefined && Number.isFinite(forced) ? forced : hourOf(store.now)
  })
}
