import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import type { AdminSession } from '#shared/types/smartRoom'
import { isAllowedGoogleUser, parseAdminEmails } from './adminAllowlist'

// 後台有兩種登入方式，登入後都發同一種加密的 httpOnly cookie：
// - Google 登入（Supabase Auth）：信箱要在 NUXT_ADMIN_EMAILS 允許名單裡
// - 管理密碼（NUXT_ADMIN_PASSWORD）：沒有 Supabase 的記憶體模式也能用
// 這是個人 side project，不需要帳號系統；玩家操作家電仍然是公開的，
// 只有遠端控制（source: admin）、遠端復電與修改閾值／契約容量需要登入。

const SESSION_NAME = 'smart-room-admin'
const SESSION_MAX_AGE = 7 * 24 * 60 * 60

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function adminPassword(event: H3Event): string {
  return useRuntimeConfig(event).adminPassword
}

function adminEmails(event: H3Event): string[] {
  return parseAdminEmails(useRuntimeConfig(event).adminEmails)
}

// Google 登入要：允許名單、伺服器能驗證 token（secret key）、瀏覽器能跳去 Google（publishable key）
function googleLoginEnabled(event: H3Event): boolean {
  const config = useRuntimeConfig(event)
  return adminEmails(event).length > 0 && Boolean(useServerSupabase()) && Boolean(config.public.supabaseKey)
}

// 開發模式下什麼登入方式都沒設定就不擋，clone 下來可以直接用；正式環境一律要登入
function loginRequired(event: H3Event): boolean {
  return Boolean(adminPassword(event)) || googleLoginEnabled(event) || !import.meta.dev
}

// h3 的 session 加密金鑰至少要 32 字元；從伺服器已經有的祕密衍生，就不用再多設一個環境變數。
// 有管理密碼就用密碼（改密碼時所有登入狀態一起失效），只開 Google 登入時用 Supabase 的 secret key
function sessionSecret(event: H3Event): string {
  return adminPassword(event) || useRuntimeConfig(event).supabaseServiceKey
}

function session(event: H3Event) {
  return useSession<{ admin?: boolean; email?: string }>(event, {
    name: SESSION_NAME,
    password: sha256(`smart-room-session:${sessionSecret(event)}`).toString('hex'),
    maxAge: SESSION_MAX_AGE,
    cookie: { httpOnly: true, sameSite: 'lax', secure: !import.meta.dev }
  })
}

export async function isAdmin(event: H3Event): Promise<boolean> {
  if (!loginRequired(event)) return true
  if (!sessionSecret(event)) return false
  return (await session(event)).data.admin === true
}

export async function requireAdmin(event: H3Event): Promise<void> {
  if (!(await isAdmin(event))) {
    throw createError({ statusCode: 401, statusMessage: '需要管理員登入' })
  }
}

export async function adminSession(event: H3Event): Promise<AdminSession> {
  const authenticated = await isAdmin(event)
  const email = authenticated && sessionSecret(event) ? ((await session(event)).data.email ?? null) : null
  return {
    authenticated,
    loginRequired: loginRequired(event),
    passwordLogin: Boolean(adminPassword(event)),
    googleLogin: googleLoginEnabled(event),
    email
  }
}

// 比對雜湊值而不是直接比字串：timingSafeEqual 要求兩邊長度相同，也避免用回應時間猜出密碼
export async function loginWithPassword(event: H3Event, password: string): Promise<boolean> {
  const expected = adminPassword(event)
  if (!expected || !timingSafeEqual(sha256(password), sha256(expected))) return false
  await (await session(event)).update({ admin: true, email: undefined })
  return true
}

// 瀏覽器完成 Google 登入後，把 Supabase 的 access token 交給伺服器：
// 向 Supabase 確認 token 有效、拿到真正的使用者，再檢查允許名單。
// 前端送來的信箱一律不信，只看 Supabase 回傳的
export async function loginWithGoogle(event: H3Event, accessToken: string): Promise<'ok' | 'invalid' | 'forbidden'> {
  const client = useServerSupabase()
  if (!client || !googleLoginEnabled(event)) return 'invalid'
  const { data, error } = await client.auth.getUser(accessToken)
  if (error || !data.user) return 'invalid'
  if (!isAllowedGoogleUser(data.user, adminEmails(event))) return 'forbidden'
  await (await session(event)).update({ admin: true, email: data.user.email!.toLowerCase() })
  return 'ok'
}

export async function logout(event: H3Event): Promise<void> {
  if (sessionSecret(event)) await (await session(event)).clear()
}
