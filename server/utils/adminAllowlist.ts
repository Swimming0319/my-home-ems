// 後台 Google 登入的允許名單（NUXT_ADMIN_EMAILS，逗號分隔）。
// 任何 Google 帳號都能完成 Supabase 的 OAuth 流程，所以「誰是管理員」一定要在伺服器端另外檢查。

export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

// Supabase 回傳的使用者裡用得到的欄位
export interface AuthUserLike {
  email?: string | null
  email_confirmed_at?: string | null
  app_metadata?: { provider?: string; providers?: string[] }
}

// 只接受「用 Google 登入、信箱已驗證、在允許名單裡」的帳號。
// 檢查登入方式：如果 Supabase 也開了信箱註冊，別人可以用你的信箱註冊一個帳號，不能只看 email
export function isAllowedGoogleUser(user: AuthUserLike | null | undefined, allowlist: string[]): boolean {
  if (!user?.email || !user.email_confirmed_at) return false
  const providers = user.app_metadata?.providers ?? (user.app_metadata?.provider ? [user.app_metadata.provider] : [])
  if (!providers.includes('google')) return false
  return allowlist.includes(user.email.toLowerCase())
}
