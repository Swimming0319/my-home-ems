<script setup lang="ts">
import type { Device, DeviceCommand, Reading } from '#shared/types/smartRoom'

// 前台的遙控面板：角色走到家電旁邊按 E（或點「使用」）時打開
const props = defineProps<{
  device: Device
  reading: Reading | null
  pending: boolean
  powerOut: boolean
}>()

const emit = defineEmits<{
  command: [command: Omit<DeviceCommand, 'source'>]
  close: []
}>()

const level = computed<VisualLevel>(() => visualLevel(props.device, props.reading))
</script>

<template>
  <section
    class="pointer-events-auto w-full max-w-sm rounded-2xl border border-l-4 border-line border-l-(--level-color) bg-bg/90 p-4 shadow-2xl backdrop-blur"
    :style="{ '--level-color': LEVEL_COLORS[level] }"
    :aria-label="`${device.name}遙控面板`"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="font-bold">{{ device.name }}</h2>
        <p class="mt-0.5 text-[13px] text-muted">
          {{ reading ? STATUS_LABELS[reading.status] : '無資料' }}
          <template v-if="reading?.set_temp_c != null"> · 設定 {{ reading.set_temp_c }}°C</template>
        </p>
      </div>
      <button
        type="button"
        class="-m-1 cursor-pointer rounded-md px-2 py-1 text-muted hover:text-ink"
        aria-label="關閉遙控面板"
        @click="emit('close')"
      >
        ✕
      </button>
    </div>

    <p class="mt-3">
      <span class="text-3xl font-bold tabular-nums">{{ reading?.power_watts ?? '—' }}</span>
      <span class="ml-1 text-sm text-muted">/ {{ device.power_threshold_watts }} W</span>
    </p>
    <!-- 「快超過」的提示：用電接近閾值時就先提醒，而不是等超過才變紅 -->
    <p v-if="level === 'warning'" class="mt-1 text-[13px] font-semibold text-warning">
      快到用電閾值了{{ device.kind === 'air_conditioner' ? '，調高 1–2°C 可以省不少電' : '' }}
    </p>
    <p v-else-if="level === 'alert'" class="mt-1 text-[13px] font-semibold text-alert">已超過用電閾值</p>
    <p v-if="powerOut" class="mt-1 text-[13px] font-semibold text-alert">停電中，先到電箱把總開關扳回去</p>

    <DeviceControls
      class="mt-4"
      :device="device"
      :reading="reading"
      :pending="pending"
      :power-out="powerOut"
      shortcuts
      @command="(c) => emit('command', c)"
    />
    <p class="mt-3 text-xs text-muted pointer-coarse:hidden">按數字鍵操作 · E 或 Esc 關閉</p>
  </section>
</template>
