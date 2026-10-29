<script setup lang="ts">
import type { Chart, ChartDataset, Plugin } from 'chart.js'
import type { Device, Reading } from '#shared/types/smartRoom'

const props = defineProps<{
  device: Device
  readings: Reading[]
  playhead: number | null
  bounds: { min: number; max: number }
}>()

const emit = defineEmits<{ seek: [time: number | null] }>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
let chart: Chart<'line' | 'bar', { x: number; y: number }[]> | null = null

const SLOT_MS = 5 * 60 * 1000
const sliderValue = computed<number>(() => props.playhead ?? props.bounds.max)
const showsWater = computed<boolean>(() => props.device.type === 'water')

function hourTicks(min: number, max: number): number[] {
  const tick = new Date(min)
  tick.setMinutes(0, 0, 0)
  while (tick.getTime() < min || tick.getHours() % 3 !== 0) tick.setHours(tick.getHours() + 1)
  const ticks: number[] = []
  for (; tick.getTime() <= max; tick.setHours(tick.getHours() + 3)) ticks.push(tick.getTime())
  return ticks
}

function onSlider(event: Event) {
  emit('seek', Number((event.target as HTMLInputElement).value))
}

function powerPoints() {
  return props.readings.map((r) => ({ x: Date.parse(r.timestamp), y: r.power_watts }))
}

function waterPoints() {
  return props.readings.map((r) => ({ x: Date.parse(r.timestamp), y: r.water_liters ?? 0 }))
}

function thresholdPoints() {
  return [
    { x: props.bounds.min, y: props.device.power_threshold_watts },
    { x: props.bounds.max, y: props.device.power_threshold_watts }
  ]
}

function buildDatasets(): ChartDataset<'line' | 'bar', { x: number; y: number }[]>[] {
  const datasets: ChartDataset<'line' | 'bar', { x: number; y: number }[]>[] = [
    {
      type: 'line',
      label: '耗電 (W)',
      data: powerPoints(),
      borderColor: LEVEL_COLORS.active,
      backgroundColor: 'rgb(62 207 142 / 0.12)',
      borderWidth: 1.5,
      pointRadius: 0,
      stepped: 'before',
      fill: true,
      yAxisID: 'y',
      // 接近／超過閾值的線段改畫黃／紅色，跟 3D 場景的發光一致
      segment: {
        borderColor: (ctx) => {
          // stepped: 'before' 的線段畫的是終點 p1 的值
          const level = levelForWatts(ctx.p1.parsed.y!, props.device.power_threshold_watts)
          return level === 'normal' ? undefined : LEVEL_COLORS[level]
        }
      }
    },
    {
      type: 'line',
      label: '閾值',
      data: thresholdPoints(),
      borderColor: 'rgb(255 77 79 / 0.6)',
      borderDash: [6, 4],
      borderWidth: 1,
      pointRadius: 0,
      yAxisID: 'y'
    }
  ]
  if (showsWater.value) {
    datasets.push({
      type: 'bar',
      label: '用水 (L)',
      data: waterPoints(),
      backgroundColor: 'rgb(58 141 222 / 0.7)',
      barThickness: 3,
      yAxisID: 'y1'
    })
  }
  return datasets
}

// 在圖上畫一條垂直線標示目前拉桿的位置（即時模式就畫在最右邊）
const playheadPlugin: Plugin<'line' | 'bar'> = {
  id: 'playhead',
  afterDatasetsDraw(c) {
    const x = c.scales.x!.getPixelForValue(sliderValue.value)
    const { top, bottom } = c.chartArea
    const ctx = c.ctx
    ctx.save()
    ctx.strokeStyle = props.playhead === null ? LEVEL_COLORS.active : '#ffd166'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
    ctx.restore()
  }
}

onMounted(async () => {
  const {
    Chart: ChartJS,
    LineController,
    BarController,
    LineElement,
    BarElement,
    PointElement,
    LinearScale,
    Filler,
    Tooltip,
    Legend
  } = await import('chart.js')
  ChartJS.register(LineController, BarController, LineElement, BarElement, PointElement, LinearScale, Filler, Tooltip, Legend)
  if (!canvasEl.value) return

  chart = new ChartJS<'line' | 'bar', { x: number; y: number }[]>(canvasEl.value, {
    type: 'line',
    data: { datasets: buildDatasets() },
    plugins: [playheadPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      color: '#aab3c2',
      scales: {
        x: {
          // 用 linear 軸自己格式化時間，省掉另外裝 chart.js 的日期 adapter
          type: 'linear',
          min: props.bounds.min,
          max: props.bounds.max,
          ticks: { color: '#8a93a3', callback: (value) => formatTime(Number(value)) },
          // linear 軸自動產生的刻度不會對齊整點（會出現 18:59 這種值），改成自己放每 3 小時的整點
          afterBuildTicks: (axis) => {
            axis.ticks = hourTicks(axis.min, axis.max).map((value) => ({ value }))
          },
          grid: { color: 'rgb(255 255 255 / 0.05)' }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'W', color: '#8a93a3' },
          ticks: { color: '#8a93a3' },
          grid: { color: 'rgb(255 255 255 / 0.05)' }
        },
        y1: {
          display: showsWater.value,
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: 'L', color: '#8a93a3' },
          ticks: { color: '#8a93a3' },
          grid: { drawOnChartArea: false }
        }
      },
      plugins: {
        legend: { labels: { boxWidth: 12, color: '#aab3c2' } },
        tooltip: {
          callbacks: { title: (items) => (items[0] ? formatDateTime(items[0].parsed.x!) : '') }
        }
      },
      onClick(event, _elements, c) {
        const x = event.x
        if (x === null) return
        const time = c.scales.x!.getValueForPixel(x)
        if (time === undefined) return
        emit('seek', Math.round(time / SLOT_MS) * SLOT_MS)
      }
    }
  })
})

watch(
  // 閾值是直接改在同一個 device 物件上的（後台調整），要另外盯著，閾值線才會跟著移動
  () => [props.device, props.device.power_threshold_watts, props.readings, props.bounds] as const,
  () => {
    if (!chart) return
    chart.data.datasets = buildDatasets()
    const scales = chart.options.scales!
    scales.x!.min = props.bounds.min
    scales.x!.max = props.bounds.max
    scales.y1!.display = showsWater.value
    chart.update('none')
  }
)

watch(
  () => props.playhead,
  () => chart?.draw()
)

onBeforeUnmount(() => {
  chart?.destroy()
  chart = null
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 寬螢幕時後台整頁固定一個畫面高，圖表跟著視窗高度縮放 -->
    <div class="relative h-[220px] lg:h-[clamp(120px,20vh,220px)]">
      <canvas ref="canvasEl" :aria-label="`${device.name}過去 24 小時耗電曲線`" role="img" />
    </div>
    <div class="flex items-center gap-2.5">
      <span class="hidden text-xs text-muted tabular-nums sm:inline">{{ formatTime(bounds.min) }}</span>
      <input
        type="range"
        class="min-w-0 flex-1 accent-highlight"
        :min="bounds.min"
        :max="bounds.max"
        :step="SLOT_MS"
        :value="sliderValue"
        aria-label="時間軸：拖曳倒帶查看歷史狀態"
        @input="onSlider"
      >
      <span class="hidden text-xs text-muted tabular-nums sm:inline">{{ formatTime(bounds.max) }}</span>
      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] whitespace-nowrap hover:border-highlight"
        @click="emit('seek', null)"
      >
        <span
          class="size-2 rounded-full"
          :class="playhead === null ? 'animate-live-pulse bg-live shadow-[0_0_6px_var(--color-live)]' : 'bg-muted'"
        />
        {{ playhead === null ? '即時' : '回到即時' }}
      </button>
    </div>
  </div>
</template>
