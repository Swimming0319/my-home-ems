<script setup lang="ts">
// 目前有幾個分頁開著網站（Realtime Presence，前台、後台都算，包含自己）
defineProps<{ count: number }>()
</script>

<template>
  <span class="inline-flex items-center gap-1 whitespace-nowrap tabular-nums" title="目前開著這個網站的人數（前台與後台）">
    <span aria-hidden="true">👥</span>
    {{ count <= 1 ? '只有你在線' : `${count} 人在線` }}
  </span>
</template>
