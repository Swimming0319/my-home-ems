<script setup lang="ts">
import type { Mission } from '#shared/utils/missions'

const props = withDefaults(
  defineProps<{
    missions: Mission[]
    // 手機版放在頂部列下面：外框由外層提供，預設收合
    inline?: boolean
    // 數字一變就收合（手機上點了房間），展開的清單才不會一直擋著畫面
    collapseKey?: number
  }>(),
  { inline: false, collapseKey: 0 }
)

const doneCount = computed<number>(() => props.missions.filter((m) => m.status === 'ok').length)

const open = ref<boolean>(!props.inline)
watch(
  () => props.collapseKey,
  () => {
    if (props.inline) open.value = false
  }
)
</script>

<template>
  <!-- 用原生 details 收合：手機上畫面小，可以收起來只看標題 -->
  <details
    :open="open"
    class="group text-sm"
    :class="inline ? '' : 'w-64 rounded-xl border border-white/10 bg-surface/90 px-4 py-3 shadow-lg shadow-black/30 backdrop-blur'"
    @toggle="open = ($event.target as HTMLDetailsElement).open"
  >
    <summary class="flex cursor-pointer list-none items-center justify-between gap-2" :class="inline ? 'text-xs' : 'font-bold'">
      今日任務
      <span class="text-xs font-normal text-muted">
        {{ doneCount }} / {{ missions.length }} 達成中
        <span class="ml-1 inline-block transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
      </span>
    </summary>
    <ul class="mt-2 flex flex-col gap-2">
      <li v-for="mission in missions" :key="mission.id" class="flex gap-2">
        <span
          class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-bg"
          :class="mission.status === 'ok' ? 'bg-live' : 'bg-alert'"
          :aria-label="mission.status === 'ok' ? '達成中' : '失敗'"
        >
          {{ mission.status === 'ok' ? '✓' : '✕' }}
        </span>
        <div class="min-w-0 flex-1">
          <p :class="mission.status === 'failed' ? 'text-muted line-through' : ''">{{ mission.title }}</p>
          <p class="text-xs text-muted">{{ mission.detail }}</p>
          <div v-if="mission.progress !== undefined" class="mt-1 h-1 overflow-hidden rounded-full bg-line">
            <div
              class="h-full rounded-full"
              :class="mission.status === 'ok' ? 'bg-live' : 'bg-alert'"
              :style="{ width: `${mission.progress * 100}%` }"
            />
          </div>
        </div>
      </li>
    </ul>
    <p class="mt-2 text-[11px] text-muted">全房間一起完成，每天 0 點重新開始</p>
  </details>
</template>
