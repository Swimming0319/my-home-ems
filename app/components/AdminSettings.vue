<script setup lang="ts">
import { useDevicesStore } from '~/stores/devices'

// 訪客模式：看得到目前的閾值與契約容量，但欄位停用、沒有儲存按鈕
withDefaults(defineProps<{ readonly?: boolean }>(), { readonly: false })

const store = useDevicesStore()

// 表單草稿：跟目前的設定分開，Realtime 推播進來的新值不會蓋掉正在輸入的內容
const thresholdDrafts = ref<Record<string, number>>({})
const limitDraft = ref<number>(store.houseLimit)
const saving = ref<boolean>(false)
const message = ref<{ text: string; ok: boolean } | null>(null)

function reset() {
  limitDraft.value = store.houseLimit
  for (const device of store.devices) thresholdDrafts.value[device.id] = device.power_threshold_watts
  message.value = null
}

// 第一次拿到資料（頁面剛載入時 store 可能還是空的）就填進表單；電器清單與契約容量是同一次載入一起設定的
watch(
  () => store.devices.length,
  (count, previous) => {
    if (count > 0 && !previous) reset()
  },
  { immediate: true }
)

const changed = computed<boolean>(
  () =>
    limitDraft.value !== store.houseLimit ||
    store.devices.some((d) => thresholdDrafts.value[d.id] !== d.power_threshold_watts)
)


async function save() {
  saving.value = true
  message.value = null
  const errors: string[] = []
  for (const device of store.devices) {
    const draft = thresholdDrafts.value[device.id]
    if (draft === undefined || draft === device.power_threshold_watts) continue
    try {
      await store.updateThreshold(device.id, draft)
    } catch (err) {
      errors.push(`${device.name}：${apiErrorMessage(err, '儲存失敗')}`)
    }
  }
  if (limitDraft.value !== store.houseLimit) {
    try {
      await store.updateHouseLimit(limitDraft.value)
    } catch (err) {
      errors.push(`契約容量：${apiErrorMessage(err, '儲存失敗')}`)
    }
  }
  message.value = errors.length > 0 ? { text: errors.join('；'), ok: false } : { text: '已儲存，所有頁面會即時套用', ok: true }
  saving.value = false
}

const inputClass =
  'w-24 rounded-md border border-line bg-bg px-2 py-1 text-right tabular-nums outline-none focus:border-highlight'
</script>

<template>
  <!-- 外框、標題由外層（後台的設定抽屜）提供 -->
  <form @submit.prevent="save">
    <p v-if="readonly" class="mb-3 rounded-lg bg-highlight/10 px-3 py-2 text-xs text-highlight">
      訪客模式只能查看，<NuxtLink to="/admin/login" class="underline underline-offset-2">登入</NuxtLink>後才能修改
    </p>
    <fieldset :disabled="readonly" class="flex flex-col gap-2 text-[13px] disabled:opacity-70">
      <label v-for="device in store.devices" :key="device.id" class="flex items-center justify-between gap-3">
        <span>{{ device.name }}閾值</span>
        <span class="flex items-center gap-1.5">
          <input
            v-model.number="thresholdDrafts[device.id]"
            type="number"
            :min="DEVICE_THRESHOLD_MIN"
            :max="DEVICE_THRESHOLD_MAX"
            step="10"
            required
            :class="inputClass"
          >
          <span class="text-muted">W</span>
        </span>
      </label>
      <label class="mt-1 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span class="font-semibold">全屋契約容量</span>
        <span class="flex items-center gap-1.5">
          <input
            v-model.number="limitDraft"
            type="number"
            :min="HOUSE_LIMIT_MIN"
            :max="HOUSE_LIMIT_MAX"
            step="100"
            required
            :class="inputClass"
          >
          <span class="text-muted">W</span>
        </span>
      </label>
      <p class="text-xs text-muted">全屋連續超過契約容量 {{ BREAKER_GRACE_MS / 1000 }} 秒就會跳電，所有家電斷電</p>
    </fieldset>

    <p v-if="message" class="mt-2 text-xs" :class="message.ok ? 'text-live' : 'text-alert'" role="status">{{ message.text }}</p>

    <div v-if="!readonly" class="mt-3 flex gap-2">
      <button
        type="submit"
        class="cursor-pointer rounded-lg bg-highlight px-3 py-1.5 text-[13px] font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!changed || saving"
      >
        {{ saving ? '儲存中…' : '儲存' }}
      </button>
      <button
        type="button"
        class="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[13px] hover:border-highlight disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!changed || saving"
        @click="reset"
      >
        還原
      </button>
    </div>
  </form>
</template>
