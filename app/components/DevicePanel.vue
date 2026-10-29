<script setup lang="ts">
import type { Device, DeviceCommand, Reading } from '#shared/types/smartRoom'

defineProps<{
  devices: Device[]
  readings: Record<string, Reading | null>
  selectedId: string | null
  pendingDeviceId: string | null
  powerOut: boolean
  // 訪客模式：只看狀態，不顯示遠端控制按鈕
  readonly: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  command: [id: string, command: Omit<DeviceCommand, 'source'>]
}>()

const WATTS_TEXT: Record<VisualLevel, string> = {
  off: 'text-muted',
  idle: '',
  active: '',
  warning: 'text-warning',
  alert: 'text-alert'
}
</script>

<template>
  <!-- 一台家電一行；點一下選取（下方圖表切換到這台），選取的那行展開操作按鈕。
       家電有 8 台，每台都展開的話後台一個畫面放不下 -->
  <ul class="flex flex-col gap-1.5">
    <!-- 狀態色是執行期才知道的值，用 CSS 變數傳進來，再由 border-l-(--level-color) 這類 utility 取用 -->
    <li
      v-for="device in devices"
      :key="device.id"
      class="cursor-pointer rounded-lg border border-l-4 border-l-(--level-color) bg-surface px-3 py-1.5 transition-colors hover:bg-surface-hover"
      :class="device.id === selectedId ? 'border-highlight' : 'border-line'"
      :style="{ '--level-color': LEVEL_COLORS[visualLevel(device, readings[device.id] ?? null)] }"
      @click="emit('select', device.id)"
    >
      <div class="flex items-center gap-2 text-sm">
        <button
          type="button"
          class="cursor-pointer font-bold"
          :aria-pressed="device.id === selectedId"
          :aria-expanded="device.id === selectedId"
          @click.stop="emit('select', device.id)"
        >
          {{ device.name }}
        </button>
        <span class="inline-flex items-center gap-1 text-xs text-muted">
          <span class="size-1.5 rounded-full bg-(--level-color) shadow-[0_0_6px_var(--level-color)]" />
          {{ readings[device.id] ? STATUS_LABELS[readings[device.id]!.status] : '無資料' }}
        </span>
        <span class="ml-auto whitespace-nowrap tabular-nums">
          <strong :class="WATTS_TEXT[visualLevel(device, readings[device.id] ?? null)]">{{ readings[device.id]?.power_watts ?? '—' }}</strong>
          <span class="text-xs text-muted"> / {{ device.power_threshold_watts }} W</span>
        </span>
      </div>

      <div v-if="device.id === selectedId" class="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pb-0.5">
        <span class="flex gap-x-3 text-xs text-muted">
          <span v-if="readings[device.id]?.set_temp_c != null">設定 {{ readings[device.id]!.set_temp_c }}°C</span>
          <span v-if="device.type === 'water'">用水 {{ readings[device.id]?.water_liters ?? 0 }} L / 5 分鐘</span>
          <span v-if="visualLevel(device, readings[device.id] ?? null) === 'warning'" class="font-semibold text-warning">接近閾值</span>
          <span v-if="visualLevel(device, readings[device.id] ?? null) === 'alert'" class="font-semibold text-alert">超過閾值</span>
        </span>
        <span v-if="readonly" class="text-xs text-muted">登入後可遠端控制</span>
        <!-- 按鈕點擊不要冒泡成「選取這張卡片」 -->
        <DeviceControls
          v-else
          :device="device"
          :reading="readings[device.id] ?? null"
          :pending="pendingDeviceId === device.id"
          :power-out="powerOut"
          @click.stop
          @command="(command) => emit('command', device.id, command)"
        />
      </div>
    </li>
  </ul>
</template>
