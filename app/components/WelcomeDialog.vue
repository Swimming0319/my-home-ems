<script setup lang="ts">
// 第一次進前台的歡迎視窗：一句話說清楚這是什麼、可以玩什麼，再讓人選要不要跟著導覽走一遍
const emit = defineEmits<{ close: [startTour: boolean] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const closing = ref<boolean>(false)

// 用原生 <dialog> 的 showModal：焦點鎖在視窗裡、背景遮罩由瀏覽器處理
onMounted(() => dialog.value?.showModal())

function close(startTour: boolean) {
  if (closing.value) return
  closing.value = true
  dialog.value?.close()
  emit('close', startTour)
}

const FEATURES = [
  { icon: '🔌', title: '操作 7 種家電', detail: '冷氣、電視、洗衣機、廚房家電，耗電量即時跳動' },
  { icon: '⚡', title: '超過 3,000 W 會跳電', detail: '整間停電，要走到電箱把總開關扳回去' },
  { icon: '📊', title: '後台即時監控', detail: '用電曲線、警示紀錄、遠端控制與復電' }
]
</script>

<template>
  <!-- Esc 關閉時 dialog 會自己觸發 close 事件，當作「自己逛逛」 -->
  <dialog
    ref="dialog"
    class="m-auto w-[min(420px,calc(100vw-32px))] rounded-2xl border border-white/10 bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/60"
    aria-labelledby="welcome-title"
    @close="close(false)"
  >
    <div class="flex flex-col gap-4 p-5">
      <div>
        <h2 id="welcome-title" class="text-xl font-bold">歡迎來到用電小屋</h2>
        <p class="mt-1 text-sm text-muted">
          一間模擬的套房：你在房間裡開關家電，用電量、警示和跳電會即時同步到後台。所有訪客看到的是同一間房間。
        </p>
      </div>

      <ul class="flex flex-col gap-2.5">
        <li v-for="feature in FEATURES" :key="feature.title" class="flex gap-3 rounded-xl bg-bg/60 px-3 py-2.5">
          <span class="text-xl leading-none" aria-hidden="true">{{ feature.icon }}</span>
          <div>
            <p class="text-sm font-bold">{{ feature.title }}</p>
            <p class="text-xs text-muted">{{ feature.detail }}</p>
          </div>
        </li>
      </ul>

      <p class="text-xs text-muted pointer-coarse:hidden">💡 想看即時同步？開兩個視窗，一邊前台、一邊後台。</p>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="flex-1 cursor-pointer rounded-full bg-highlight px-4 py-2.5 text-sm font-bold text-bg hover:brightness-110"
          autofocus
          @click="close(true)"
        >
          開始導覽（約 1 分鐘）
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-full border border-white/15 px-4 py-2.5 text-sm hover:bg-surface-hover"
          @click="close(false)"
        >
          自己逛逛
        </button>
      </div>
    </div>
  </dialog>
</template>
