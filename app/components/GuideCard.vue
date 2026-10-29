<script setup lang="ts">
import type { GuideStep, GuideStepId } from '~/composables/useGuideTour'

const props = withDefaults(
  defineProps<{
    steps: GuideStep[]
    // 手機版：放在頂部列下面，平常只顯示目前這一步，點「2 / 4 ▾」才展開全部步驟
    inline?: boolean
    // 數字一變就收合（手機上點了房間），展開的清單才不會一直擋著畫面
    collapseKey?: number
  }>(),
  { inline: false, collapseKey: 0 }
)

const emit = defineEmits<{ close: [] }>()

const currentIndex = computed<number>(() => props.steps.findIndex((step) => !step.done))
const currentId = computed<GuideStepId | null>(() => props.steps[currentIndex.value]?.id ?? null)
const current = computed<GuideStep | null>(() => props.steps[currentIndex.value] ?? null)
const doneCount = computed<number>(() => props.steps.filter((step) => step.done).length)

const expanded = ref<boolean>(!props.inline)
watch(
  () => props.collapseKey,
  () => {
    if (props.inline) expanded.value = false
  }
)
</script>

<template>
  <section
    class="text-sm"
    :class="inline ? '' : 'w-72 rounded-xl border border-white/10 bg-surface/90 px-4 py-3 shadow-lg shadow-black/30 backdrop-blur'"
    aria-label="新手導覽"
  >
    <!-- 手機收合時：一行標題列就是目前這一步，下面接提示與捷徑按鈕 -->
    <template v-if="inline && !expanded && current">
      <div class="flex items-start gap-2">
        <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-highlight text-[10px] font-black text-bg">
          {{ currentIndex + 1 }}
        </span>
        <p class="min-w-0 flex-1 font-semibold">{{ current.title }}</p>
        <button
          type="button"
          class="shrink-0 cursor-pointer text-xs text-muted"
          :aria-expanded="false"
          aria-label="展開導覽步驟"
          @click="expanded = true"
        >
          {{ doneCount }} / {{ steps.length }} ▾
        </button>
        <button type="button" class="shrink-0 cursor-pointer px-1 text-xs text-muted" aria-label="關閉導覽" @click="emit('close')">✕</button>
      </div>
      <p class="mt-0.5 pl-6 text-xs text-ink/75">
        <span :class="{ 'pointer-coarse:hidden': current.touchHint }">{{ current.hint }}</span>
        <span v-if="current.touchHint" class="hidden pointer-coarse:inline">{{ current.touchHint }}</span>
      </p>
      <button
        v-if="current.action"
        type="button"
        class="mt-1.5 ml-6 cursor-pointer rounded-full border border-highlight px-3 py-1 text-xs font-semibold text-highlight"
        @click="current.action.run()"
      >
        {{ current.action.label }}
      </button>
    </template>

    <template v-else>
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-bold text-highlight" :class="{ 'text-xs': inline }">新手導覽</h2>
        <span class="flex items-center gap-2 text-xs text-muted">
          <button
            v-if="inline && currentId"
            type="button"
            class="cursor-pointer"
            :aria-expanded="true"
            aria-label="收合導覽步驟"
            @click="expanded = false"
          >
            {{ doneCount }} / {{ steps.length }} ▴
          </button>
          <template v-else>{{ doneCount }} / {{ steps.length }}</template>
          <button type="button" class="cursor-pointer rounded px-1 hover:text-ink" aria-label="關閉導覽" @click="emit('close')">✕</button>
        </span>
      </div>

      <ol v-if="currentId" class="mt-2 flex flex-col gap-1.5">
        <li v-for="(step, index) in steps" :key="step.id" class="flex gap-2">
          <span
            class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
            :class="step.done ? 'bg-live text-bg' : step.id === currentId ? 'bg-highlight text-bg' : 'bg-line text-muted'"
          >
            {{ step.done ? '✓' : index + 1 }}
          </span>
          <div class="min-w-0 flex-1">
            <p :class="step.done ? 'text-muted line-through' : step.id === currentId ? 'font-semibold' : 'text-muted'">{{ step.title }}</p>
            <p v-if="step.id === currentId" class="mt-0.5 text-xs text-ink/75">
              <span :class="{ 'pointer-coarse:hidden': step.touchHint }">{{ step.hint }}</span>
              <span v-if="step.touchHint" class="hidden pointer-coarse:inline">{{ step.touchHint }}</span>
            </p>
            <button
              v-if="step.id === currentId && step.action"
              type="button"
              class="mt-1.5 cursor-pointer rounded-full border border-highlight px-3 py-1 text-xs font-semibold text-highlight hover:bg-highlight/10"
              @click="step.action.run()"
            >
              {{ step.action.label }}
            </button>
          </div>
        </li>
      </ol>

      <!-- 全部做完：最後一步是去後台，看剛剛那次跳電被記錄下來 -->
      <div v-else class="mt-2 flex flex-col gap-2">
        <p>🎉 全部完成！剛剛的超載和跳電都記在後台了。</p>
        <NuxtLink to="/admin" class="self-start rounded-full bg-highlight px-3.5 py-1.5 text-xs font-bold text-bg hover:brightness-110">
          到後台看紀錄 →
        </NuxtLink>
      </div>
    </template>
  </section>
</template>
