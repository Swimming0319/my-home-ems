// 公開共用的房間誰都能操作，限制每個 IP 的請求頻率，避免有人寫腳本狂按把事件表灌爆、或暴力猜管理密碼。
// 用記憶體內的 Map 就夠：部署在 Vercel 時每個 serverless 實例各自計數、重啟就歸零，
// 擋不住刻意的攻擊，但對「手動狂點」這種情境已經足夠。
const WINDOW_MS = 60_000

const history = new Map<string, number[]>()

export const RATE_LIMITS = {
  command: 30,
  login: 5
} as const

export function allowRequest(kind: keyof typeof RATE_LIMITS, key: string, now: number): boolean {
  const bucket = `${kind}:${key}`
  const recent = (history.get(bucket) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= RATE_LIMITS[kind]) {
    history.set(bucket, recent)
    return false
  }
  recent.push(now)
  history.set(bucket, recent)
  return true
}
