<script setup lang="ts">
// 別人操作家電時的短暫提示（「有人打開了冷氣」）：房間是共用的，但看不到其他人的角色，
// 不提示的話家電看起來像是自己變了。幾秒後自動消失，不擋操作
defineProps<{ items: { id: number; text: string }[] }>()
</script>

<template>
  <TransitionGroup
    tag="ul"
    class="pointer-events-none flex flex-col items-center gap-1.5"
    aria-live="polite"
    enter-active-class="transition duration-300 motion-reduce:transition-none"
    enter-from-class="-translate-y-1 opacity-0"
    leave-active-class="transition duration-300 motion-reduce:transition-none"
    leave-to-class="opacity-0"
  >
    <li
      v-for="item in items"
      :key="item.id"
      class="rounded-full border border-white/10 bg-surface/90 px-3.5 py-1.5 text-sm shadow-lg shadow-black/30 backdrop-blur"
    >
      <span aria-hidden="true">👋 </span>{{ item.text }}
    </li>
  </TransitionGroup>
</template>
