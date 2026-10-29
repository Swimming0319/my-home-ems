<script setup lang="ts">
import type { LiveMode } from '~/stores/devices'

const props = withDefaults(
  defineProps<{
    liveMode: LiveMode
    playhead: number | null
    // 只顯示圓點（手機版頂部列放不下文字），文字留給螢幕閱讀器
    compact?: boolean
  }>(),
  { compact: false }
)

const LABELS: Record<LiveMode, string> = {
  connecting: '連線中…',
  realtime: '即時同步中',
  polling: '輪詢模式（每 10 秒更新）'
}

const label = computed<string>(() => (props.playhead !== null ? `回放 ${formatDateTime(props.playhead)}` : LABELS[props.liveMode]))
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 tabular-nums"
    :class="playhead !== null ? 'text-highlight' : liveMode === 'realtime' ? 'text-live' : 'text-muted'"
    :title="compact ? label : liveMode === 'polling' ? '沒有設定 Supabase publishable key，或 Realtime 連線中斷' : undefined"
  >
    <span
      class="size-2 rounded-full bg-current"
      :class="{ 'animate-live-pulse shadow-[0_0_6px_currentColor]': playhead === null && liveMode === 'realtime' }"
    />
    <span :class="{ 'sr-only': compact }">{{ label }}</span>
  </span>
</template>
