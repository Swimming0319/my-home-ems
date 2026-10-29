// Supabase 後台同時列出 Project URL 與 REST endpoint（多了 /rest/v1/），很容易貼錯；
// supabase-js 會自己再接一次 /rest/v1，貼錯會變成 PGRST125 Invalid path
export function normalizeSupabaseUrl(url: string): string {
  return url.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
}
