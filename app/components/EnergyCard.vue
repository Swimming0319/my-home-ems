<script setup lang="ts">
import type { EnergySummary } from '~/stores/devices'

defineProps<{ energy: EnergySummary }>()

const kwh = (value: number) => value.toFixed(value < 10 ? 2 : 1)
</script>

<template>
  <section class="rounded-xl border border-line bg-surface px-4 py-3 text-[13px]" aria-label="電費試算">
    <h2 class="flex items-baseline justify-between text-[15px] font-bold">
      電費試算
      <span class="text-xs font-normal text-muted">台電{{ energy.summer ? '夏月' : '非夏月' }}累進電價</span>
    </h2>
    <p class="mt-1.5 flex gap-x-4 text-muted">
      <span>今天 <strong class="text-ink tabular-nums">{{ kwh(energy.todayKwh) }}</strong> 度</span>
      <span>過去 24 小時 <strong class="text-ink tabular-nums">{{ kwh(energy.last24hKwh) }}</strong> 度</span>
    </p>
    <p class="mt-1">
      照這樣用，一個月約 <strong class="tabular-nums">{{ Math.round(energy.monthlyKwh) }}</strong> 度，電費約
      <strong class="text-base text-highlight tabular-nums">${{ Math.round(energy.monthlyBill).toLocaleString() }}</strong>
    </p>
  </section>
</template>
