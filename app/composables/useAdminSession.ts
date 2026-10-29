import type { AdminSession } from '#shared/types/smartRoom'

// 後台登入狀態。用 useState 讓 middleware、頁面、元件共用同一份；
// SSR 時要用 useRequestFetch 才會把瀏覽器的 cookie 轉送給 API
export function useAdminSession() {
  const session = useState<AdminSession | null>('admin-session', () => null)
  const requestFetch = useRequestFetch()

  async function refresh() {
    session.value = await requestFetch<AdminSession>('/api/admin/session')
    return session.value
  }

  async function login(password: string) {
    session.value = await $fetch<AdminSession>('/api/admin/login', { method: 'POST', body: { password } })
  }

  async function logout() {
    await $fetch('/api/admin/logout', { method: 'POST' })
    if (session.value) session.value = { ...session.value, authenticated: false, email: null }
  }

  return { session, refresh, login, logout }
}
