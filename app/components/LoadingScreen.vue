<script setup lang="ts">
// 進頁面時的 loading：小電箱的總開關往下、指示燈閃紅燈，下面列出真實的載入進度；
// 全部準備好之後總開關「啪」一聲扳上去、燈轉綠，再整個淡出，房間一次完整出現。
// 造型跟房間裡的電箱一樣，玩家之後在房間裡看到電箱會有印象。
const props = defineProps<{
  steps: { label: string; done: boolean }[]
  error: string | null
}>()

const emit = defineEmits<{ done: [] }>()

// 扳上去之後停留多久再淡出（讓玩家看到扳上去、燈轉綠），以及淡出的時間
const SWITCH_HOLD_MS = 700
const FADE_MS = 500

const ready = computed<boolean>(() => props.steps.every((step) => step.done))
const switchedOn = ref<boolean>(false)
const fading = ref<boolean>(false)
const timers: ReturnType<typeof setTimeout>[] = []

watch(
  ready,
  (isReady) => {
    if (!isReady || switchedOn.value) return
    switchedOn.value = true
    timers.push(
      setTimeout(() => {
        fading.value = true
        timers.push(setTimeout(() => emit('done'), FADE_MS))
      }, SWITCH_HOLD_MS)
    )
  },
  { immediate: true }
)

onBeforeUnmount(() => timers.forEach(clearTimeout))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-scene transition-opacity duration-500 motion-reduce:transition-none"
    :class="fading ? 'pointer-events-none opacity-0' : 'opacity-100'"
    role="status"
    aria-live="polite"
  >
    <div class="flex flex-col items-center gap-6 px-4">
      <!-- 電箱 -->
      <div class="relative h-40 w-32 rounded-2xl bg-[#c3c9d1] shadow-[0_10px_30px_rgb(0_0_0/0.45),inset_0_-6px_0_rgb(0_0_0/0.12)]" aria-hidden="true">
        <div class="absolute inset-x-3 top-3 h-24 rounded-lg bg-[#aab1bb]" />
        <!-- 指示燈：等待時閃紅燈，通電後轉綠 -->
        <span
          class="absolute top-5 right-5 size-2.5 rounded-full transition-colors duration-200"
          :class="switchedOn ? 'bg-live shadow-[0_0_10px_var(--color-live)]' : 'animate-pulse bg-alert shadow-[0_0_10px_var(--color-alert)]'"
        />
        <!-- 總開關：繞著溝槽中間的樞紐轉，往下是斷電、往上是通電 -->
        <div class="absolute top-7 left-1/2 h-16 w-6 -translate-x-1/2 rounded-full bg-[#7d8590]">
          <span
            class="absolute bottom-1/2 left-1/2 h-9 w-4 -translate-x-1/2 origin-bottom rounded-md bg-[#2b2f36] transition-transform duration-300 ease-[cubic-bezier(0.3,1.6,0.5,1)] motion-reduce:transition-none"
            :class="switchedOn ? 'rotate-0' : 'rotate-180'"
          />
        </div>
        <span class="absolute bottom-3 left-1/2 -translate-x-1/2 text-lg leading-none text-[#f2c14e]">⚡</span>
      </div>

      <div class="text-center">
        <p class="text-lg font-bold">{{ switchedOn ? '通電完成' : '通電中…' }}</p>
        <p class="mt-0.5 text-xs text-muted">用電小屋</p>
      </div>

      <ul class="flex flex-col gap-1.5 text-sm">
        <li v-for="step in steps" :key="step.label" class="flex items-center gap-2" :class="step.done ? 'text-ink' : 'text-muted'">
          <span v-if="step.done" class="flex size-4 items-center justify-center rounded-full bg-live text-[10px] font-black text-bg">✓</span>
          <span v-else class="size-4 animate-spin rounded-full border-2 border-line border-t-highlight motion-reduce:animate-none" />
          {{ step.label }}
        </li>
      </ul>

      <p v-if="error" class="max-w-xs text-center text-sm text-alert" role="alert">{{ error }}</p>
    </div>
  </div>
</template>
