<script setup lang="ts">
import type { AlertLevel } from '#shared/types/smartRoom'
import type { AlertLogEntry } from '~/utils/alertLog'
import { useDevicesStore } from '~/stores/devices'

useHead({ title: '監控後台 · 用電小屋' })
definePageMeta({ middleware: 'admin' })

const store = useDevicesStore()
const hour = useDayHour()

// 進頁面的 loading：資料、3D 場景、家具都準備好才淡出
const sceneReady = ref<boolean>(false)
const furnitureReady = ref<boolean>(false)
const showLoading = ref<boolean>(true)
const loadingSteps = computed(() => [
  { label: '讀取用電資料', done: store.loaded },
  { label: '準備 3D 房間', done: sceneReady.value },
  { label: '佈置家具', done: furnitureReady.value }
])

function onSceneLoaded(stage: 'scene' | 'furniture') {
  if (stage === 'scene') sceneReady.value = true
  else furnitureReady.value = true
}
const { session, logout } = useAdminSession()
// 沒登入就是訪客模式：看得到所有監控資料，但不能遠端控制、復電、改設定
const canControl = computed<boolean>(() => session.value?.authenticated === true)

async function signOut() {
  await logout()
}

// 只在瀏覽器端載入：即時狀態每秒推算、時間依瀏覽器時區格式化，
// 放到 SSR 反而會因為伺服器/瀏覽器時間與時區不同造成 hydration 不一致。
onMounted(() => store.startLive())
onBeforeUnmount(() => store.stopLive())

const HOUSE_LEVEL_TEXT: Record<AlertLevel, string> = {
  normal: '',
  warning: 'text-warning',
  alert: 'text-alert'
}

function pickAlert(entry: AlertLogEntry) {
  if (entry.deviceId) store.select(entry.deviceId)
  store.setPlayhead(entry.time)
}

// 用電設定不常用，收進側邊抽屜，騰出空間讓後台一個畫面就放得下。
// 用原生 <dialog> 的 showModal：Esc 關閉、焦點鎖在抽屜裡、背景遮罩都由瀏覽器處理
const settingsDialog = ref<HTMLDialogElement | null>(null)

function openSettings() {
  settingsDialog.value?.showModal()
}

function closeSettings() {
  settingsDialog.value?.close()
}

// 點抽屜外面的遮罩就關閉（點到遮罩時 target 是 dialog 本身）
function onDialogClick(e: MouseEvent) {
  if (e.target === settingsDialog.value) closeSettings()
}
</script>

<template>
  <!-- 寬螢幕時整頁固定一個畫面高、不捲動，內容多的區塊（警示紀錄）只在自己的框內捲動；
       窄螢幕或高度太矮時維持一般的上下捲動 -->
  <div class="mx-auto flex max-w-[1600px] flex-col px-4 py-4 lg:h-dvh lg:min-h-[640px]">
    <header class="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3">
      <div>
        <p class="flex flex-wrap gap-x-3 text-[13px] text-muted">
          <span>後台</span>
          <NuxtLink to="/" class="underline-offset-2 hover:text-ink hover:underline">前往前台 →</NuxtLink>
          <template v-if="!canControl">
            <span class="rounded-full bg-highlight/15 px-2 font-semibold text-highlight">訪客模式（唯讀）</span>
            <NuxtLink to="/admin/login" class="underline-offset-2 hover:text-ink hover:underline">管理員登入</NuxtLink>
          </template>
          <template v-else-if="session?.loginRequired">
            <span v-if="session.email">管理員：{{ session.email }}</span>
            <button type="button" class="cursor-pointer underline-offset-2 hover:text-ink hover:underline" @click="signOut">
              登出
            </button>
          </template>
          <span v-else class="text-warning">開發模式：未設定登入方式，不需登入</span>
        </p>
        <h1 class="text-[22px] font-bold">用電小屋 · 監控後台</h1>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <LiveStatus :live-mode="store.liveMode" :playhead="store.playhead" />
        <span>
          全屋用電
          <strong class="text-xl tabular-nums" :class="HOUSE_LEVEL_TEXT[store.houseLevel]">{{ store.totalWatts.toLocaleString() }}</strong>
          <span class="text-muted"> / {{ store.houseLimit.toLocaleString() }} W</span>
        </span>
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] hover:border-highlight"
          aria-haspopup="dialog"
          @click="openSettings"
        >
          <span aria-hidden="true">⚙</span>
          用電設定
        </button>
      </div>
    </header>

    <div class="mb-3 flex shrink-0 flex-col gap-2 empty:hidden">
      <p v-if="store.error" class="rounded-lg bg-alert/12 px-3.5 py-2.5 text-[#ff8a8b]" role="alert">{{ store.error }}</p>
      <p v-if="store.commandError" class="rounded-lg bg-alert/12 px-3.5 py-2.5 text-[#ff8a8b]" role="alert">{{ store.commandError }}</p>
      <HouseAlertBanner
        :total-watts="store.totalWatts"
        :level="store.houseLevel"
        :limit="store.houseLimit"
        :countdown="store.breakerCountdown"
        :power-out="store.powerOut"
        :auto-restore-in="store.autoRestoreIn"
      >
        <button
          v-if="store.powerOut && canControl"
          type="button"
          class="shrink-0 cursor-pointer rounded-md bg-alert px-3 py-1 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="store.resetting"
          @click="store.resetBreaker('admin')"
        >
          {{ store.resetting ? '復電中…' : '遠端復電' }}
        </button>
      </HouseAlertBanner>
    </div>

    <main
      class="grid grid-cols-1 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)_auto]"
    >
      <section class="h-[44vh] min-h-80 overflow-hidden rounded-xl lg:h-auto lg:min-h-0" aria-label="3D 房間">
        <ClientOnly>
          <RoomScene
            :devices="store.devices"
            :readings="store.currentReadings"
            :selected-id="store.selectedId"
            :power-out="store.powerOut"
            :hour="hour"
            @select="store.select"
            @loaded="onSceneLoaded"
          />
        </ClientOnly>
      </section>

      <aside class="flex flex-col gap-3 lg:row-span-2 lg:min-h-0" aria-label="電器狀態">
        <DevicePanel
          class="shrink-0"
          :devices="store.devices"
          :readings="store.currentReadings"
          :selected-id="store.selectedId"
          :pending-device-id="store.pendingDeviceId"
          :power-out="store.powerOut"
          :readonly="!canControl"
          @select="store.select"
          @command="(id, command) => store.sendCommand(id, { ...command, source: 'admin' })"
        />
        <ClientOnly>
          <EnergyCard class="shrink-0" :energy="store.energy" />
          <AlertLogList class="lg:flex-1" :entries="store.alertLog" @pick="pickAlert" />
        </ClientOnly>
      </aside>

      <section class="rounded-xl border border-line bg-surface px-4 py-3" aria-label="歷史用電">
        <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 v-if="store.selectedDevice" class="text-[15px] font-bold">{{ store.selectedDevice.name }} · 過去 24 小時</h2>
          <p class="text-xs text-muted">點右側卡片切換家電，拖曳時間軸或點警示紀錄可倒帶</p>
        </div>
        <ClientOnly>
          <TimelineChart
            v-if="store.selectedDevice && store.timeBounds"
            :device="store.selectedDevice"
            :readings="store.history[store.selectedDevice.id] ?? []"
            :playhead="store.playhead"
            :bounds="store.timeBounds"
            @seek="store.setPlayhead"
          />
        </ClientOnly>
        <p v-if="!store.timeBounds" class="text-sm text-muted">載入中…</p>
      </section>
    </main>

    <dialog
      ref="settingsDialog"
      class="ml-auto h-dvh max-h-none w-[min(380px,100vw)] max-w-none border-l border-line bg-surface p-0 text-ink backdrop:bg-black/50"
      aria-labelledby="settings-title"
      @click="onDialogClick"
    >
      <div class="flex h-full flex-col gap-4 p-5">
        <div class="flex items-center justify-between">
          <h2 id="settings-title" class="text-base font-bold">用電設定</h2>
          <button
            type="button"
            class="-m-1 cursor-pointer rounded-md px-2 py-1 text-muted hover:text-ink"
            aria-label="關閉用電設定"
            @click="closeSettings"
          >
            ✕
          </button>
        </div>
        <ClientOnly>
          <AdminSettings :readonly="!canControl" />
        </ClientOnly>
      </div>
    </dialog>

    <LoadingScreen v-if="showLoading" :steps="loadingSteps" :error="store.error" @done="showLoading = false" />
  </div>
</template>
