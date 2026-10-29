import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

// 後台用單一管理密碼（NUXT_ADMIN_PASSWORD）保護，登入後發一個加密的 httpOnly cookie。
// 這是個人 side project，不需要帳號系統；玩家操作家電仍然是公開的，
// 只有遠端控制（source: admin）與修改閾值／契約容量需要登入。

const SESSION_NAME = 'smart-room-admin'
const SESSION_MAX_AGE = 7 * 24 * 60 * 60

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function adminPassword(event: H3Event): string {
  return useRuntimeConfig(event).adminPassword
}

// 開發模式下沒設定密碼就不擋，clone 下來可以直接用；正式環境沒設定則一律拒絕
export function passwordRequired(event: H3Event): boolean {
  return Boolean(adminPassword(event)) || !import.meta.dev
}

function session(event: H3Event) {
  return useSession<{ admin?: boolean }>(event, {
    name: SESSION_NAME,
    // h3 的 session 加密金鑰至少要 32 字元；從管理密碼衍生，就不用再多設一個環境變數，
    // 而且改密碼時舊的登入狀態會自動全部失效
    password: sha256(`smart-room-session:${adminPassword(event)}`).toString('hex'),
    maxAge: SESSION_MAX_AGE,
    cookie: { httpOnly: true, sameSite: 'lax', secure: !import.meta.dev }
  })
}

export async function isAdmin(event: H3Event): Promise<boolean> {
  if (!adminPassword(event)) return !passwordRequired(event)
  return (await session(event)).data.admin === true
}

export async function requireAdmin(event: H3Event): Promise<void> {
  if (!(await isAdmin(event))) {
    throw createError({ statusCode: 401, statusMessage: '需要管理員登入' })
  }
}

// 比對雜湊值而不是直接比字串：timingSafeEqual 要求兩邊長度相同，也避免用回應時間猜出密碼
export async function login(event: H3Event, password: string): Promise<boolean> {
  const expected = adminPassword(event)
  if (!expected || !timingSafeEqual(sha256(password), sha256(expected))) return false
  await (await session(event)).update({ admin: true })
  return true
}

export async function logout(event: H3Event): Promise<void> {
  if (adminPassword(event)) await (await session(event)).clear()
}
