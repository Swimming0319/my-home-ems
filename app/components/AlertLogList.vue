<script setup lang="ts">
import type { AlertLogEntry } from '~/utils/alertLog'

defineProps<{ entries: AlertLogEntry[] }>()

const emit = defineEmits<{ pick: [entry: AlertLogEntry] }>()
</script>

<template>
  <!-- 寬螢幕時由外層決定高度，紀錄多了只在框內捲動，不會把整頁撐長 -->
  <div class="flex min-h-0 flex-col rounded-xl border border-line bg-surface px-4 py-3">
    <h2 class="text-[15px] font-bold">警示紀錄 · 24 小時</h2>
    <p v-if="entries.length === 0" class="mt-2 text-[13px] text-muted">目前沒有任何警示</p>
    <ul v-else class="mt-2 flex max-h-64 min-h-0 flex-col gap-1 overflow-y-auto lg:max-h-none lg:flex-1">
      <li v-for="entry in entries" :key="`${entry.deviceId}-${entry.time}`">
        <!-- 點一筆紀錄就把時間軸倒帶到那個時間點，3D 場景會顯示當時的狀態 -->
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-hover"
          @click="emit('pick', entry)"
        >
          <span class="size-2 shrink-0 rounded-full" :class="entry.level === 'alert' ? 'bg-alert' : 'bg-warning'" />
          <span class="text-muted tabular-nums">{{ formatTime(entry.time) }}</span>
          <span class="font-semibold">{{ entry.label }}</span>
          <span class="ml-auto tabular-nums" :class="entry.level === 'alert' ? 'text-alert' : 'text-warning'">
            {{ entry.watts.toLocaleString() }} / {{ entry.limit.toLocaleString() }} W
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
