<script setup lang="ts">
import type { Device, DeviceCommand, Reading } from '#shared/types/smartRoom'

// 後台卡片與前台遙控面板共用的操作按鈕
const props = withDefaults(
  defineProps<{
    device: Device
    reading: Reading | null
    pending: boolean
    // 停電中：所有按鈕都不能按
    powerOut?: boolean
    // 前台遙控面板用：按鈕依序對應數字鍵 1、2、3…，打開時焦點移到第一個按鈕。
    // 後台同時有好幾張卡片，數字鍵不知道該對應哪一台，所以預設關閉
    shortcuts?: boolean
  }>(),
  { shortcuts: false, powerOut: false }
)

const emit = defineEmits<{ command: [command: Omit<DeviceCommand, 'source'>] }>()

const TOGGLE_LABELS: Record<Device['kind'], [on: string, off: string]> = {
  air_conditioner: ['開機', '關機'],
  tv: ['開機', '關機'],
  washer: ['開始洗衣', '停止'],
  fridge: ['插上電源', '拔掉電源'],
  microwave: ['開始加熱', '停止'],
  kettle: ['煮開水', '停止'],
  light: ['開燈', '關燈']
}

interface ControlAction {
  label: string
  ariaLabel?: string
  command: Omit<DeviceCommand, 'source'>
  disabled: boolean
}

const actions = computed<ControlAction[]>(() => {
  const isOn = props.reading?.status === 'on' || props.reading?.status === 'running'
  const blocked = props.pending || props.powerOut
  const list: ControlAction[] = [
    {
      label: TOGGLE_LABELS[props.device.kind][isOn ? 1 : 0],
      command: { action: isOn ? 'power_off' : 'power_on' },
      disabled: blocked
    }
  ]
  if (props.device.kind === 'air_conditioner') {
    const setTemp = props.reading?.set_temp_c ?? AC_DEFAULT_TEMP
    list.push(
      {
        label: '−1°C',
        ariaLabel: '調低溫度',
        command: { action: 'set_temp', set_temp_c: setTemp - 1 },
        disabled: blocked || setTemp <= AC_TEMP_MIN
      },
      {
        label: '+1°C',
        ariaLabel: '調高溫度',
        command: { action: 'set_temp', set_temp_c: setTemp + 1 },
        disabled: blocked || setTemp >= AC_TEMP_MAX
      }
    )
  }
  return list
})

function run(action: ControlAction) {
  if (!action.disabled) emit('command', action.command)
}

const firstButton = ref<HTMLButtonElement | null>(null)

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
  // Digit1／Numpad1 → 第 1 個按鈕；用 code 而不是 key，注音輸入法下也能用
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  const action = match ? actions.value[Number(match[1]) - 1] : undefined
  if (!action) return
  e.preventDefault()
  run(action)
}

onMounted(() => {
  if (!props.shortcuts) return
  window.addEventListener('keydown', onKeyDown)
  firstButton.value?.focus()
})

// 送指令期間按鈕是 disabled，瀏覽器會把焦點從 disabled 的元素移走、之後也不會還回來；
// 指令完成後把焦點放回第一個按鈕，接著按 Enter／空白鍵才有反應
watch(
  () => props.pending,
  async (pending, wasPending) => {
    if (!props.shortcuts || pending || !wasPending) return
    await nextTick()
    if (!document.activeElement || document.activeElement === document.body) firstButton.value?.focus()
  }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

const buttonClass =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] transition-colors hover:border-highlight focus-visible:border-highlight focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line'
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <!-- 用位置當 key：按鈕文字會隨狀態改變（開始洗衣 → 停止），用文字當 key 會重建按鈕、焦點跟著不見 -->
    <button
      v-for="(action, index) in actions"
      :key="index"
      :ref="index === 0 ? (el) => (firstButton = el as HTMLButtonElement | null) : undefined"
      type="button"
      :class="buttonClass"
      :aria-label="action.ariaLabel"
      :aria-keyshortcuts="shortcuts ? String(index + 1) : undefined"
      :disabled="action.disabled"
      @click="run(action)"
    >
      <kbd
        v-if="shortcuts"
        class="rounded border border-line bg-surface px-1 font-sans text-[11px] leading-4 text-muted pointer-coarse:hidden"
      >
        {{ index + 1 }}
      </kbd>
      {{ action.label }}
    </button>
  </div>
</template>
