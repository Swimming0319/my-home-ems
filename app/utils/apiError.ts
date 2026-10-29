// 從 $fetch 的錯誤裡取出伺服器給的訊息。不能用 FetchError.statusMessage：那是 HTTP 狀態列的文字，
// 狀態列不能放中文，h3 會把中文濾掉換回預設的英文（例如 "Unauthorized"）；
// 完整的中文訊息在回應的 JSON body（err.data）裡
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { statusMessage?: unknown; message?: unknown } } | null)?.data
  const message = data?.statusMessage ?? data?.message
  return typeof message === 'string' && message ? message : fallback
}
