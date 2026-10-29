<script setup lang="ts">
import type { AlertLevel } from '#shared/types/smartRoom'

const props = defineProps<{
  totalWatts: number
  level: AlertLevel
  limit: number
  // 超載時距離跳電還有幾秒；null 代表沒有在倒數
  countdown: number | null
  // 跳電中（停電）
  powerOut: boolean
}>()

const message = computed<{ text: string; tone: 'alert' | 'warning' } | null>(() => {
  if (props.level === 'alert') {
    const limit = props.limit.toLocaleString()
    return props.countdown !== null && props.countdown > 0
      ? { text: `全屋用電超過契約容量 ${limit}W！${props.countdown} 秒內不關掉家電就會跳電`, tone: 'alert' }
      : { text: `全屋用電超過契約容量 ${limit}W！即將跳電…`, tone: 'alert' }
  }
  // 停電時用電一定是 0，放在超載判斷之後也不會被蓋掉
  if (props.powerOut) return { text: '⚡ 跳電了！全屋用電超過契約容量，整間停電，要到電箱把總開關扳回去', tone: 'alert' }
  if (props.level === 'warning') {
    const ratio = Math.round((props.totalWatts / props.limit) * 100)
    return { text: `全屋用電已達契約容量的 ${ratio}%，再開大電器可能會跳電`, tone: 'warning' }
  }
  return null
})
</script>

<template>
  <!-- 預設插槽放額外的操作按鈕（後台停電時的「遠端復電」） -->
  <div
    v-if="message"
    class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg px-3.5 py-2.5"
    :class="message.tone === 'alert' ? 'bg-alert/15 font-semibold text-alert' : 'bg-warning/15 text-warning'"
    :role="message.tone === 'alert' ? 'alert' : 'status'"
  >
    <p>{{ message.text }}</p>
    <slot />
  </div>
</template>
