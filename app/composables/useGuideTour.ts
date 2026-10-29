// 前台的新手導覽：第一次進來先跳歡迎視窗，選「開始導覽」後左下角列出步驟。
// 步驟是「真的做到了」才自動打勾（走近家電、送出指令、看到跳電、看到復電），不用按「下一步」，
// 審閱作品的人一分鐘內就能走完最核心的流程：操作家電 → 超載跳電 → 到電箱復電 → 去後台看紀錄。
// 房間是大家共用的，進來時可能已經停電，所以步驟不強制順序，只有「復電」要先看過停電才算。
export type GuideStepId = 'walk' | 'use' | 'trip' | 'restore'

export interface GuideStep {
  id: GuideStepId
  title: string
  hint: string
  // 觸控裝置沒有鍵盤，提示要換個說法
  touchHint?: string
  // 目前這一步的捷徑按鈕（例如「帶我去電箱」）
  action?: { label: string; run: () => void }
  done: boolean
}

// 看過歡迎視窗就不再自動跳出（只是個人方便，讀寫失敗就當沒看過）
const SEEN_KEY = 'yongdian-xiaowu:guide-seen'

export function useGuideTour(input: { nearDevice: Readonly<Ref<boolean>>; powerOut: Readonly<Ref<boolean>> }) {
  const welcomeOpen = ref<boolean>(false)
  const active = ref<boolean>(false)
  const done = reactive<Record<GuideStepId, boolean>>({ walk: false, use: false, trip: false, restore: false })

  watch(input.nearDevice, (near) => {
    if (active.value && near) done.walk = true
  })
  watch(
    input.powerOut,
    (out) => {
      if (!active.value) return
      if (out) done.trip = true
      else if (done.trip) done.restore = true
    },
    { immediate: true }
  )

  // 進頁面（loading 結束）時呼叫：第一次來才跳歡迎視窗
  function maybeWelcome() {
    let seen = false
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1'
    } catch {
      // 無痕模式或封鎖儲存空間：每次都跳也沒關係
    }
    if (!seen) welcomeOpen.value = true
  }

  function closeWelcome(startTour: boolean) {
    welcomeOpen.value = false
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // 同上
    }
    if (startTour) start()
  }

  function start() {
    for (const id of Object.keys(done) as GuideStepId[]) done[id] = false
    active.value = true
    // 開始時已經站在家電旁邊、或房間已經停電，直接算數
    if (input.nearDevice.value) done.walk = true
    if (input.powerOut.value) done.trip = true
  }

  function markUsed() {
    if (active.value) done.use = true
  }

  function stop() {
    active.value = false
  }

  return { welcomeOpen, active, done, maybeWelcome, closeWelcome, start, markUsed, stop }
}
