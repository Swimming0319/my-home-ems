<script setup lang="ts">
import type { DeviceCommand } from '#shared/types/smartRoom'
import type { GuideStep } from '~/composables/useGuideTour'
import type { RestPose } from '~/utils/playerController'
import type { FurnitureAction, NearbyTarget } from '~/utils/roomFurniture'
import { useDevicesStore } from '~/stores/devices'

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

function onLoadingDone() {
  showLoading.value = false
  tour.maybeWelcome()
}

function onSceneLoaded(stage: 'scene' | 'furniture') {
  if (stage === 'scene') sceneReady.value = true
  else furnitureReady.value = true
}
const cycle = computed(() => dayCycle(hour.value))

// 角色附近可以互動的家電或家具（由 3D 場景回報）、正在操作哪台家電、是否坐著／躺著
const nearby = ref<NearbyTarget | null>(null)
const remoteId = ref<string | null>(null)
const restPose = ref<RestPose | null>(null)
const scene = ref<{
  rest: (furnitureId: string, pose: RestPose) => void
  standUp: () => void
  operateBreaker: () => void
  walkToBreaker: () => void
} | null>(null)

const nearbyId = computed(() => (nearby.value?.kind === 'device' ? nearby.value.id : null))
const nearbyDevice = computed(() => store.devices.find((d) => d.id === nearbyId.value) ?? null)
const nearbyFurniture = computed(() => (nearby.value?.kind === 'furniture' ? nearby.value : null))
const nearBreaker = computed(() => nearby.value?.kind === 'breaker')
const remoteDevice = computed(() => store.devices.find((d) => d.id === remoteId.value) ?? null)

// 包一層 reactive，模板裡就不用寫 .value
const tour = reactive(
  useGuideTour({
    nearDevice: computed(() => nearbyDevice.value !== null),
    powerOut: computed(() => store.powerOut)
  })
)
const guideSteps = computed<GuideStep[]>(() => [
  {
    id: 'walk',
    title: '走到任一台家電旁邊',
    hint: '用 WASD／方向鍵，或點地板走過去',
    touchHint: '點一下地板或家電就會走過去',
    done: tour.done.walk
  },
  {
    id: 'use',
    title: '打開一台家電',
    hint: '靠近家電按 E 叫出遙控面板',
    touchHint: '點畫面下方的「使用」按鈕叫出遙控面板',
    done: tour.done.use
  },
  {
    id: 'trip',
    title: `讓全屋超過 ${store.houseLimit.toLocaleString()} W，跳一次電`,
    // 微波爐、熱水壺是定時家電，先開才會在走去開冷氣的路上停掉，所以冷氣先開
    hint: `先開冷氣，再開微波爐和熱水壺，超載撐過 ${BREAKER_GRACE_MS / 1000} 秒就會跳電（現在 ${store.totalWatts.toLocaleString()} W）`,
    done: tour.done.trip
  },
  {
    id: 'restore',
    title: '到電箱扳回總開關',
    hint: '電箱在左邊牆上最前面，靠近按 E',
    touchHint: '電箱在左邊牆上最前面，走過去按「扳回總開關」',
    action: { label: '帶我去電箱', run: () => scene.value?.walkToBreaker() },
    done: tour.done.restore
  }
])

// 手機上點了房間（走路、旋轉鏡頭）就把頂部展開的導覽步驟／今日任務收起來
const sceneTaps = ref<number>(0)

// 家具動作的快捷鍵：第一個 E、第二個 R
const FURNITURE_KEYS = ['E', 'R']

function onNearby(target: NearbyTarget | null) {
  nearby.value = target
}

function onRest(pose: RestPose | null) {
  restPose.value = pose
  if (pose) remoteId.value = null
}

// 角色在電箱扳了總開關（3D 場景播完伸手的動作後通知）
function onBreaker() {
  if (store.powerOut) store.resetBreaker('player')
}

function doFurnitureAction(action: FurnitureAction | undefined) {
  if (nearbyFurniture.value && action) scene.value?.rest(nearbyFurniture.value.id, action.pose)
}

async function sendCommand(command: Omit<DeviceCommand, 'source'>) {
  if (!remoteId.value) return
  // 導覽第 3 步（跳電）完成前送出的指令都標記 guided：這段期間造成的跳電是示範，不算進每日任務
  await store.sendCommand(remoteId.value, { ...command, source: 'player', guided: tour.active && !tour.done.trip })
  if (!store.commandError) tour.markUsed()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.code === 'KeyE' && restPose.value) {
    scene.value?.standUp()
  } else if (e.code === 'KeyE' && nearBreaker.value) {
    scene.value?.operateBreaker()
  } else if (e.code === 'KeyE' && nearbyId.value) {
    remoteId.value = remoteId.value ? null : nearbyId.value
  } else if (e.code === 'KeyE' && nearbyFurniture.value) {
    doFurnitureAction(nearbyFurniture.value.actions[0])
  } else if (e.code === 'KeyR' && nearbyFurniture.value && !restPose.value) {
    doFurnitureAction(nearbyFurniture.value.actions[1])
  } else if (e.code === 'Escape') {
    if (remoteId.value) remoteId.value = null
    else scene.value?.standUp()
  }
}

onMounted(() => {
  store.startLive()
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  store.stopLive()
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="relative h-dvh w-full overflow-hidden bg-scene">
    <ClientOnly>
      <RoomScene
        ref="scene"
        mode="player"
        :devices="store.devices"
        :readings="store.currentReadings"
        :selected-id="remoteId ?? nearbyId"
        :interacting-id="remoteId"
        :power-out="store.powerOut"
        :hour="hour"
        @nearby="onNearby"
        @arrive="(id) => (remoteId = id)"
        @rest="onRest"
        @leave="remoteId = null"
        @breaker="onBreaker"
        @loaded="onSceneLoaded"
        @pointerdown="sceneTaps++"
      />
    </ClientOnly>

    <header class="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3 md:p-4">
      <div class="flex items-start justify-between gap-2 md:gap-3">
        <!-- 手機版：只留一行用電數字，房間才不會被擋住；完整資訊在桌面版與後台。
             寬度很緊（4 位數瓦數＋右邊兩顆按鈕），日夜圖示省略，窗外的天色看得出來 -->
        <ClientOnly>
          <p
            class="pointer-events-auto flex min-w-0 items-center gap-2 truncate rounded-full border border-white/10 bg-surface/90 px-3 py-2 text-sm shadow-lg shadow-black/30 backdrop-blur md:hidden"
          >
            <span class="tabular-nums">
              <strong :class="{ 'text-warning': store.houseLevel === 'warning', 'text-alert': store.houseLevel === 'alert' }">
                {{ store.totalWatts.toLocaleString() }}
              </strong>
              <!-- 375 以下放不下契約容量（右邊有「導覽」「後台」兩顆按鈕，電費可能 4 位數），只留瓦數；接近上限時下方的警示會寫出契約容量 -->
              <span class="text-muted"><span class="max-[374px]:hidden">/{{ store.houseLimit.toLocaleString() }}</span> W</span>
            </span>
            <span class="tabular-nums" title="月電費估算">
              <strong class="text-highlight">${{ Math.round(store.energy.monthlyBill).toLocaleString() }}</strong>
              <span class="text-xs text-muted">/月</span>
            </span>
            <LiveStatus compact :live-mode="store.liveMode" :playhead="null" />
          </p>
        </ClientOnly>
        <!-- 資訊框的底色跟房間外圍的背景很接近，靠外框和陰影把邊界拉出來 -->
        <div class="pointer-events-auto hidden rounded-xl border border-white/10 bg-surface/90 px-4 py-3 shadow-lg shadow-black/30 backdrop-blur md:block">
          <h1 class="text-lg font-bold">用電小屋</h1>
          <p class="text-[11px] text-muted">模擬套房的即時用電監控</p>
          <p class="mt-0.5 text-sm">
            全屋用電
            <strong class="tabular-nums" :class="{ 'text-warning': store.houseLevel === 'warning', 'text-alert': store.houseLevel === 'alert' }">
              {{ store.totalWatts.toLocaleString() }}
            </strong>
            <span class="text-muted"> / {{ store.houseLimit.toLocaleString() }} W</span>
          </p>
          <ClientOnly>
            <p class="mt-0.5 text-xs text-muted">
              今天 {{ store.energy.todayKwh.toFixed(1) }} 度 · 月電費估
              <strong class="text-highlight">${{ Math.round(store.energy.monthlyBill).toLocaleString() }}</strong>
            </p>
            <p class="mt-0.5 text-xs text-muted">{{ cycle.icon }} {{ cycle.label }}</p>
          </ClientOnly>
          <p class="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
            <LiveStatus :live-mode="store.liveMode" :playhead="null" />
            <ClientOnly>
              <OnlineCount v-if="store.onlineCount" class="text-muted" :count="store.onlineCount" />
            </ClientOnly>
          </p>
        </div>
        <div class="pointer-events-auto flex shrink-0 items-center gap-2">
          <!-- 手機上內距收窄，讓出空間給左邊的用電數字 -->
          <button
            v-if="!tour.active"
            type="button"
            class="cursor-pointer rounded-full border border-white/15 bg-surface/90 px-3 py-2 text-sm shadow-lg shadow-black/30 backdrop-blur hover:bg-surface-hover md:px-3.5"
            @click="tour.start()"
          >
            導覽
          </button>
          <!-- 後台是作品的另一半，用主色按鈕讓第一次來的人一眼看到；手機上字縮短，才放得進用電數字那一行 -->
          <NuxtLink to="/admin" class="rounded-full bg-highlight px-3 py-2 text-sm font-bold text-bg shadow-lg shadow-black/30 hover:brightness-110 md:px-4">
            後台<span class="max-md:hidden">監控</span> →
          </NuxtLink>
        </div>
      </div>

      <!-- 手機版的導覽（只顯示目前這一步）／今日任務（預設收合）放在頂部列下面：畫面底部要留給操作按鈕與遙控面板。
           點房間時 sceneTaps 會加一，展開的清單自動收起 -->
      <ClientOnly>
        <div
          v-if="tour.active"
          class="pointer-events-auto rounded-xl border border-white/10 bg-surface/90 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur md:hidden"
        >
          <GuideCard inline :steps="guideSteps" :collapse-key="sceneTaps" @close="tour.stop()" />
        </div>
        <div v-else class="flex flex-wrap items-start gap-2 md:hidden">
          <div class="pointer-events-auto max-w-full rounded-xl border border-white/10 bg-surface/90 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur">
            <MissionList class="max-w-64" inline :missions="store.missions" :collapse-key="sceneTaps" />
          </div>
          <!-- 手機版頂部那一行放不下人數，放在今日任務旁邊 -->
          <OnlineCount
            v-if="store.onlineCount"
            class="rounded-full border border-white/10 bg-surface/90 px-3 py-1.5 text-xs text-muted shadow-lg shadow-black/30 backdrop-blur"
            :count="store.onlineCount"
          />
        </div>
        <!-- 別人操作家電的提示：放在頂部資訊下面、畫面正中間，不跟底部的操作按鈕、遙控面板搶位置 -->
        <ActivityToasts class="self-center" :items="store.activity" />
      </ClientOnly>
    </header>

    <!-- 放左下角的地板區域：右上有廚房窗戶、左上有停電時要找的電箱，都不能擋 -->
    <ClientOnly>
      <GuideCard v-if="tour.active" class="absolute bottom-4 left-4 hidden md:block" :steps="guideSteps" @close="tour.stop()" />
      <MissionList v-else class="absolute bottom-4 left-4 hidden md:block" :missions="store.missions" />
    </ClientOnly>

    <div class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4">
      <HouseAlertBanner
        class="backdrop-blur"
        :total-watts="store.totalWatts"
        :level="store.houseLevel"
        :limit="store.houseLimit"
        :countdown="store.breakerCountdown"
        :power-out="store.powerOut"
        :auto-restore-in="store.autoRestoreIn"
      />
      <p v-if="store.commandError" class="rounded-lg bg-alert/15 px-3.5 py-2 text-sm text-alert backdrop-blur" role="alert">
        {{ store.commandError }}
      </p>

      <DeviceRemote
        v-if="remoteDevice"
        :key="remoteDevice.id"
        :device="remoteDevice"
        :reading="store.currentReadings[remoteDevice.id] ?? null"
        :pending="store.pendingDeviceId === remoteDevice.id"
        :power-out="store.powerOut"
        @command="sendCommand"
        @close="remoteId = null"
      />
      <!-- 互動提示：桌面顯示 E 鍵，觸控裝置直接點按鈕 -->
      <button
        v-else-if="nearbyDevice"
        type="button"
        class="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-highlight bg-bg/90 px-4 py-2 text-sm backdrop-blur"
        @click="remoteId = nearbyDevice.id"
      >
        <kbd class="rounded border border-line bg-surface px-1.5 font-sans text-xs pointer-coarse:hidden">E</kbd>
        使用{{ nearbyDevice.name }}
      </button>
      <button
        v-else-if="nearBreaker"
        type="button"
        class="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-alert bg-bg/90 px-4 py-2 text-sm font-semibold text-alert backdrop-blur disabled:opacity-50"
        :disabled="store.resetting"
        @click="scene?.operateBreaker()"
      >
        <kbd class="rounded border border-line bg-surface px-1.5 font-sans text-xs text-ink pointer-coarse:hidden">E</kbd>
        {{ store.resetting ? '復電中…' : '扳回總開關（復電）' }}
      </button>
      <button
        v-else-if="restPose"
        type="button"
        class="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-highlight bg-bg/90 px-4 py-2 text-sm backdrop-blur"
        @click="scene?.standUp()"
      >
        <kbd class="rounded border border-line bg-surface px-1.5 font-sans text-xs pointer-coarse:hidden">E</kbd>
        起身
      </button>
      <div v-else-if="nearbyFurniture" class="pointer-events-auto flex flex-wrap justify-center gap-2">
        <button
          v-for="(action, index) in nearbyFurniture.actions"
          :key="action.pose"
          type="button"
          class="flex cursor-pointer items-center gap-2 rounded-full border border-highlight bg-bg/90 px-4 py-2 text-sm backdrop-blur"
          @click="doFurnitureAction(action)"
        >
          <kbd class="rounded border border-line bg-surface px-1.5 font-sans text-xs pointer-coarse:hidden">{{ FURNITURE_KEYS[index] }}</kbd>
          {{ action.label }}
        </button>
      </div>

      <p class="rounded-full border border-white/10 bg-surface/90 px-4 py-2 text-center text-xs text-ink/80 shadow-lg shadow-black/30 backdrop-blur">
        <span class="pointer-coarse:hidden">
          <kbd class="rounded border border-white/15 bg-bg px-1 font-sans">WASD</kbd> 移動 · 點地板走過去 · 靠近家電、沙發、床按
          <kbd class="rounded border border-white/15 bg-bg px-1 font-sans">E</kbd> · 拖曳旋轉視角
        </span>
        <span class="hidden pointer-coarse:inline">點地板走路 · 點家電、沙發、床使用 · 拖曳轉視角</span>
      </p>
    </div>

    <LoadingScreen v-if="showLoading" :steps="loadingSteps" :error="store.error" @done="onLoadingDone" />
    <WelcomeDialog v-if="tour.welcomeOpen" @close="tour.closeWelcome" />
  </div>
</template>
