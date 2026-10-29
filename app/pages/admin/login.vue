<script setup lang="ts">
useHead({ title: '後台登入 · 用電小屋' })
// 先拿到登入狀態，才知道要顯示哪幾種登入方式
definePageMeta({ middleware: 'admin' })

const route = useRoute()
const { session, login } = useAdminSession()
const password = ref<string>('')
const error = ref<string | null>(null)
const submitting = ref<boolean>(false)
// Google 登入回來、正在跟伺服器換 session
const exchanging = ref<boolean>(typeof route.query.code === 'string')

// 只有登入頁會用到 Supabase Auth，動態載入。用獨立的 storageKey，跟訂閱 Realtime 的用戶端互不干擾；
// PKCE 流程的 code verifier 要存在 localStorage，跳去 Google 再回來才拿得到
async function supabaseAuth() {
  const { supabaseUrl, supabaseKey } = useRuntimeConfig().public
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(normalizeSupabaseUrl(supabaseUrl), supabaseKey, {
    auth: { flowType: 'pkce', storageKey: 'yongdian-xiaowu-admin-auth', autoRefreshToken: false, detectSessionInUrl: false }
  }).auth
}

async function signInWithGoogle() {
  submitting.value = true
  error.value = null
  const auth = await supabaseAuth()
  const { error: oauthError } = await auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/admin/login` }
  })
  // 成功的話瀏覽器已經跳去 Google，不會執行到這裡之後
  if (oauthError) {
    error.value = '無法開啟 Google 登入，請稍後再試'
    submitting.value = false
  }
}

// 從 Google 回來：網址帶著 ?code=，換成 Supabase 的 access token，再交給伺服器檢查允許名單、發 session。
// 換完就登出 Supabase：後台只認自己的 session cookie，瀏覽器不需要留著 Supabase 的登入狀態
async function finishGoogleLogin(code: string) {
  const auth = await supabaseAuth()
  try {
    const { data, error: exchangeError } = await auth.exchangeCodeForSession(code)
    if (exchangeError || !data.session) throw new Error('exchange failed')
    session.value = await $fetch('/api/admin/google', { method: 'POST', body: { access_token: data.session.access_token } })
    await navigateTo('/admin')
  } catch (err) {
    error.value = err instanceof Error && err.message === 'exchange failed' ? 'Google 登入已失效，請再試一次' : apiErrorMessage(err, 'Google 登入失敗，請稍後再試')
    exchanging.value = false
    await navigateTo('/admin/login', { replace: true })
  } finally {
    await auth.signOut({ scope: 'local' }).catch(() => {})
  }
}

onMounted(async () => {
  const code = route.query.code
  if (typeof code === 'string') return finishGoogleLogin(code)
  // 在 Google 按了取消，Supabase 會帶著 error 參數回來
  if (route.query.error) error.value = 'Google 登入已取消'
  // 已經登入（或開發模式不需要登入）就直接進後台
  if (session.value?.authenticated) await navigateTo('/admin')
})

async function submit() {
  submitting.value = true
  error.value = null
  try {
    await login(password.value)
    await navigateTo('/admin')
  } catch (err) {
    error.value = apiErrorMessage(err, '登入失敗，請稍後再試')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center px-4">
    <div class="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
      <p class="text-[13px] text-muted">
        <NuxtLink to="/" class="underline-offset-2 hover:text-ink hover:underline">← 回前台</NuxtLink>
      </p>
      <h1 class="mt-2 text-xl font-bold">後台登入</h1>
      <p class="mt-1 text-sm text-muted">遠端控制家電、遠端復電、調整閾值與契約容量需要管理員登入</p>

      <p v-if="exchanging" class="mt-5 text-sm" role="status">Google 登入中…</p>

      <template v-else>
        <button
          v-if="session?.googleLogin"
          type="button"
          class="mt-5 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg bg-white px-4 py-2 font-semibold text-[#1f1f1f] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="submitting"
          @click="signInWithGoogle"
        >
          <svg class="size-[18px]" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          用 Google 登入
        </button>

        <div v-if="session?.googleLogin && session?.passwordLogin" class="my-4 flex items-center gap-3 text-xs text-muted">
          <span class="h-px flex-1 bg-line" />或<span class="h-px flex-1 bg-line" />
        </div>

        <form v-if="session?.passwordLogin" :class="{ 'mt-5': !session?.googleLogin }" @submit.prevent="submit">
          <label class="block text-sm" for="admin-password">管理密碼</label>
          <input
            id="admin-password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="mt-1.5 w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-highlight"
          >
          <button
            type="submit"
            class="mt-4 w-full cursor-pointer rounded-lg bg-highlight px-4 py-2 font-semibold text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="submitting || !password"
          >
            {{ submitting ? '登入中…' : '用密碼登入' }}
          </button>
        </form>

        <p v-if="session && !session.googleLogin && !session.passwordLogin" class="mt-5 text-sm text-muted">
          伺服器還沒設定登入方式（NUXT_ADMIN_EMAILS 或 NUXT_ADMIN_PASSWORD）
        </p>
      </template>

      <p v-if="error" class="mt-3 text-sm text-alert" role="alert">{{ error }}</p>

      <NuxtLink to="/admin" class="mt-4 block text-center text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
        不登入，以訪客模式查看後台
      </NuxtLink>
    </div>
  </div>
</template>
