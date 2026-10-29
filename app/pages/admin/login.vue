<script setup lang="ts">
useHead({ title: '後台登入 · 用電小屋' })

const { login, refresh } = useAdminSession()
const password = ref<string>('')
const error = ref<string | null>(null)
const submitting = ref<boolean>(false)

// 已經登入（或開發模式不需要密碼）就直接進後台
onMounted(async () => {
  if ((await refresh()).authenticated) await navigateTo('/admin')
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
    <form class="w-full max-w-sm rounded-2xl border border-line bg-surface p-6" @submit.prevent="submit">
      <p class="text-[13px] text-muted">
        <NuxtLink to="/" class="underline-offset-2 hover:text-ink hover:underline">← 回前台</NuxtLink>
      </p>
      <h1 class="mt-2 text-xl font-bold">後台登入</h1>
      <p class="mt-1 text-sm text-muted">遠端控制家電、調整閾值與契約容量需要管理密碼</p>

      <label class="mt-5 block text-sm" for="admin-password">管理密碼</label>
      <input
        id="admin-password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        class="mt-1.5 w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-highlight"
      >
      <p v-if="error" class="mt-2 text-sm text-alert" role="alert">{{ error }}</p>

      <button
        type="submit"
        class="mt-5 w-full cursor-pointer rounded-lg bg-highlight px-4 py-2 font-semibold text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="submitting || !password"
      >
        {{ submitting ? '登入中…' : '登入' }}
      </button>
      <NuxtLink to="/admin" class="mt-3 block text-center text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
        不登入，以訪客模式查看後台
      </NuxtLink>
    </form>
  </div>
</template>
