# CLAUDE.md

給 Claude Code 在這個專案裡工作時的指引。產品規劃看 [smart-room-spec.md](smart-room-spec.md)，建置／環境設定／API 看 [README.md](README.md)。

## 常用指令

```sh
npm run dev        # http://localhost:3010，沒設定 Supabase 會自動用記憶體模式
npm test           # Vitest，涵蓋 server/utils/ 底下的用電模型、指令驗證、警示規則、記憶體 repo
npm run build
```

型別檢查：`npm run typecheck`（vue-tsc）。push 到 `main` 或開 PR 時，GitHub Actions（`.github/workflows/ci.yml`）會自動跑型別檢查與測試，README 上有徽章；部署則由 Vercel 的 GitHub 整合負責，兩者互不影響。

## 回應語言與術語

沿用 bungwa 的規則：**一律繁體中文、台灣用語**（程式碼／資料／函式／元件／組合函式／狀態管理），程式碼識別字保持英文。註解只寫「為什麼」，看程式碼就懂的地方不寫。

## 架構重點

- 規劃文件寫 Nuxt 3，實際用 **Nuxt 4**（跟 bungwa 一致；`app/` 目錄結構、`shared/` 前後端共用型別）
- 前後端資料格式統一定義在 `shared/types/smartRoom.ts`，改格式先改這裡
- `server/utils/repo.ts` 是資料存取層：`supabase` / `memory` 兩種實作，`useRepo()` 依環境變數決定；記憶體模式的電器清單 `SEED_DEVICES` 要跟 `supabase/schema.sql` 的 insert 保持一致（含順序，對應 `sort_order`；Supabase 依 `sort_order` 排序）
- **後端是唯一的真實來源**：前端只能透過 `POST /api/devices/:id/commands` 送指令，不能自己改狀態再回報
- **讀數不存資料庫**：只有狀態改變時寫一筆 `device_events`，讀數由 `shared/utils/powerModel.ts` 依「當時生效的事件 + 經過時間」推算（前後端共用：後端算歷史、前端每秒算即時）。用電模型必須是純函式（雜訊的種子由電器 id 與 5 分鐘時間槽決定），不要引入 `Math.random()`，否則同一個時間點每次查詢結果不同，圖表會在輪詢時亂跳
- 家電有 7 種（`DeviceKind`）：冷氣、電視、洗衣機、冰箱、微波爐、熱水壺、電燈。「現在是不是開著」一律用 `deviceIsOn()`（`powerModel.ts`）：洗衣機、微波爐、熱水壺是定時家電（跑完固定時間自動停，`TIMED_DURATION_MS`），冰箱沒有任何事件時預設插著電。冰箱壓縮機的切換不靠事件，所以歷史讀數與跳電計算都要加上 `intrinsicChangePoints()`。新增家電種類時：`DeviceKind`、`powerModel`、`schema.sql` 的 `devices_kind_check`、`SEED_DEVICES`、`DeviceControls` 的按鈕文字、`RoomScene` 的 builder 都要改，並寫一份 `supabase/patch-*.sql`
- 房間 8 × 6（x -3 ~ 5、z -3 ~ 3），右邊 x 3 ~ 5 是廚房。微波爐、熱水壺的 builder 各自帶一段流理台（`buildCounter`），並排成一整條檯面
- 日夜循環（`app/utils/dayCycle.ts`）：跟著瀏覽器本地時間，晚上環境光剩 `NIGHT_LIGHT`，每開一盞燈補 `LAMP_FILL` 的暖色環境光（壁燈的點光源只照得到附近的牆，不補的話開燈房間還是很暗；白天開燈不補），廚房上方的窗戶畫天色／太陽／月亮。頁面用 `useDayHour()` 取得小時傳給 `RoomScene` 的 `hour`；網址加 `?hour=21.5` 可以固定時間預覽
- 電費試算（`shared/utils/energy.ts`）：台電住宅累進電價（2025/10 調整後、2026 沿用，級距以每月計），用過去 24 小時讀數積分成度數再 ×30 推估月電費。每日任務（`shared/utils/missions.ts`）：不要跳電、用電不超過 10 度、冷氣 26°C 以上，全房間共同、每天 0 點重來。兩者都在前端從 24 小時歷史算，跳電時間點另外由 `GET /api/breaker/trips` 提供。電價調整時改 `TARIFF_TIERS` 並同步規劃文件
- 頁籤 icon 與分享預覽卡片：`public/favicon.svg`（小屋＋閃電）、`favicon-32.png`、`apple-touch-icon.png`；預覽卡片的 meta 在 `nuxt.config.ts`（`SITE_URL` 換網域要一起改），圖片 `public/og-image.jpg`（1200×630）是前台 `?hour=13`、開著冷氣／電視／燈、藏掉資訊框後的截圖，左邊疊上標題與簡介。房間外觀大改時記得重做這張圖
- 進頁面的 loading（`LoadingScreen.vue`，前台與後台都有）：電箱造型，等「資料第一次載入（`store.loaded`）」、「3D 場景畫出第一格」、「家具載完」三件事都完成才扳上總開關、淡出。後兩者由 `RoomScene` 的 `loaded` 事件回報；WebGL 失敗、家具載入失敗也會回報，loading 才不會卡住
- 新手導覽（`useGuideTour`、`WelcomeDialog.vue`、`GuideCard.vue`，只在前台）：第一次進來（`localStorage` 沒有記錄）loading 結束後跳歡迎視窗；導覽步驟看「真的做到了」自動打勾（走近家電、指令送出成功、看到停電、停電後看到復電），不強制順序，因為共用房間進來時可能已經停電。導覽進行中，今日任務的位置換成導覽步驟。「帶我去電箱」呼叫 `RoomScene` 的 `walkToBreaker()`，走到電箱會自動扳總開關。改了跳電條件（契約容量、`BREAKER_GRACE_MS`、家電耗電）要確認第 3 步「冷氣＋微波爐＋熱水壺」還會跳電。導覽第 3 步完成前的指令帶 `guided: true`，存在 `device_events.guided`；跳電時 `tripIsGuided`（`shared/utils/breaker.ts`）看跳電當下開著的家電有沒有導覽中開的，有就把斷電事件也標 `guided`，每日任務不把這次跳電算失敗。新增會寫 `device_events` 的地方要記得填 `guided`
- 3D 標籤會互相避讓（`placeLabels`）：選取中、接近／超過閾值的優先放原位，其他撞到就往上疊
- 前台遙控面板只有走出正在操作的家電的互動範圍（`leave` 事件）才收起；不要用「最近的家電換了」判斷，廚房家電擠在一起，稍微動一下最近的就會變
- 指令邏輯在 `server/utils/commands.ts` 的 `applyCommand`（純函式，狀態沒變就回傳 null 不寫入）
- 警示規則（單台家電 80%／100%、全屋契約容量）在 `shared/utils/alerts.ts`，前後端共用。耗電量、閾值、契約容量、跳電秒數的來由（哪些是刻意放大）記在規劃文件「用電數字的由來」，改數字前先看，改完同步更新那一節
- 規劃文件已改為 v2（前台角色＋後台監控），建置進度以規劃文件為準
- 頁面：`/` 前台（角色操控）、`/admin` 後台。兩頁共用 `app/stores/devices.ts`，進頁面呼叫 `startLive()`、離開呼叫 `stopLive()`
- 後台版面（`pages/admin/index.vue`）：`lg` 以上整頁固定 `h-dvh`、不捲動（左：3D 房間＋圖表；右：精簡家電卡＋警示紀錄，紀錄只在框內捲動），用電設定收在 ⚙ 打開的原生 `<dialog>` 側邊抽屜。新增後台區塊時要確認 1366×768 仍然放得下；窄螢幕維持上下捲動
- 即時同步：`useDeviceEventStream` 用 publishable key 訂閱 `device_events` 的 INSERT（Supabase Realtime postgres_changes）；沒設定 key 或斷線時 store 自動退回每 10 秒輪詢，重新連上時補抓一次全部資料。同一個頻道也用 Presence 報到，key 是存在 localStorage 的訪客 id（`visitorId()`），同一個瀏覽器的前台、後台、好幾個分頁共用同一個 key，Presence 會合併成一筆；store 的 `onlineCount` 是目前在線的瀏覽器數（不同裝置、無痕視窗各算一人，本機開發連同一個 Supabase 也算），輪詢模式時是 null、不顯示。Realtime 推播的事件會先經過 `noteOthersEvent`：不是自己送出的（看 `ownEvents`／`ownActionAt`／`ownRestoreAt`，Realtime 可能比 API 回應先到，送出後 5 秒內的都算自己的）就用 `app/utils/othersActivity.ts` 描述成一句話，前台用 `ActivityToasts` 顯示幾秒；同一個時間點的多筆事件是復電，合併成一則。只有 Realtime 推播會觸發，`loadAll` 補抓不會
- 警示紀錄由 `app/utils/alertLog.ts` 從 24 小時歷史讀數推算，不存表
- **跳電是延遲結算的**（`server/utils/breaker.ts` 的 `advanceBreaker`）：送指令、`/api/events/latest`、`/api/breaker/check`、改契約容量之前都會先結算，把斷電事件補寫在精確的時間點。純計算在 `shared/utils/breaker.ts`。新增會改變狀態的 API 時，記得先呼叫 `advanceBreaker`，指令才會套用在跳電後的正確狀態上
- 前端的跳電倒數只是顯示用（store 自己觀察超載開始的時間），真正的跳電時間以伺服器為準
- **跳電後整間停電**，要到電箱（前台左牆最前面）或後台「遠端復電」才恢復（`restorePower`、`POST /api/breaker/reset`）。停電狀態存在 `house_settings.tripped_at`，停電期間指令 API 一律回 409，`advanceBreaker` 也不會再跳一次。跳電時每台家電都寫一筆 `source: system` 的斷電事件，**這種事件代表「沒有電」**：`readingFromEvent` 一律算 0W（連待機電都沒有）。復電時每台家電寫一筆新事件：冰箱、跳電前開著的電燈自動恢復（`resumesAfterOutage`），其他維持關閉、回到待機。前端停電時房間變暗、電箱上方顯示「⚡ 電箱」。**停電 5 分鐘沒人復電會自動復電**（`OUTAGE_AUTO_RESTORE_MS`）：`advanceBreaker` 一開始先檢查，把復電事件補寫在「跳電＋5 分鐘」的時間點，來源是 `auto`（`restoreAt` 與手動復電共用）；前端停電橫幅顯示倒數，時間到了呼叫 `/api/breaker/check` 觸發結算。事件來源 `system` 只能用在跳電的斷電事件，新增其他系統寫的事件要用別的來源，不然會被當成「沒有電」並算成一次跳電
- 後台登入：`server/utils/adminAuth.ts`，兩種方式登入後都發同一種 h3 加密 session cookie（金鑰由管理密碼衍生，沒有密碼時由 Supabase secret key 衍生）：**Google 登入**（Supabase Auth，PKCE；瀏覽器換到 access token 後交給 `POST /api/admin/google`，伺服器用 `auth.getUser` 驗證，`adminAllowlist.ts` 檢查「Google 登入＋信箱已驗證＋在 `NUXT_ADMIN_EMAILS` 裡」）與**管理密碼**（`NUXT_ADMIN_PASSWORD`，記憶體模式只能用這個）。前端送來的信箱一律不信，只看 Supabase 回傳的使用者。**沒登入不擋 `/admin`，以訪客模式（唯讀）顯示**，讓作品集的審閱者沒有密碼也看得到後台：`app/middleware/admin.ts` 只負責先載入登入狀態，頁面用 `canControl` 決定要不要顯示遠端控制（`DevicePanel` 的 `readonly`）、遠端復電按鈕、可編輯的用電設定（`AdminSettings` 的 `readonly`）。真正的保護在伺服器端的 `requireAdmin`，新增寫入的 API 一定要加；新增後台的操作按鈕也要跟著 `canControl` 藏起來。開發模式兩種登入方式都沒設定時不需登入（直接有管理權限）
- 契約容量存在 `house_settings`（只有一列），閾值存在 `devices`；兩者改了都會透過 Realtime 推播。store 收到新的電器清單時只更新閾值、不換掉物件，否則 `RoomScene` 會以為電器變了而重建 3D 模型
- `RoomScene.vue` 有兩種 `mode`：`admin`（點家電選取）與 `player`（建立 `playerController`、鏡頭跟著角色、回報 `nearby`／`arrive` 事件）。鍵盤操作分三處聽：WASD 在 `playerController.ts`、E／R／Esc（開關遙控面板、坐下躺下、起身）在 `pages/index.vue`、數字鍵 1–9（面板按鈕）在 `DeviceControls.vue`（只有 `shortcuts` 開啟時，也就是前台遙控面板；後台卡片有好幾張，不綁數字鍵）
- 角色：自製 Q 版角色（`app/utils/chibiCharacter.ts`），用球體／膠囊體／圓角方塊組成，骨架是巢狀 Group（髖 → 膝、肩 → 肘 → 手），待機（呼吸、眨眼）／走路／蹲下（洗衣機）／拿遙控器（冷氣、電視）都用程式產生並依權重平順混合。拿遙控器時把右肩轉向家電的 `aimAnchor`（每台電器在 `RoomScene` 的 builder 裡自己定義），遙控器是右手的子物件、直接穿過圓球拳頭。外觀顏色集中在 `ChibiLook`／`DEFAULT_LOOK`，之後要做玩家自選造型就從這裡改。預覽頁 `/character`（`?pose=remote&angle=-30` 可指定動作與視角）
- **角色的手被頭擋住不是 bug**：Q 版角色頭很大，鏡頭在背後、家電在正前上方（冷氣）時，舉起的手會被頭擋住；要檢查姿勢請轉到側面或用 `/character` 預覽頁
- 碰撞只在 XZ 平面做「圓 vs 方塊」（`app/utils/collision.ts`，純函式有測試）。方塊可以帶 `frame`（中心＋旋轉角）變成斜放的方塊，所有碰撞／距離函式都支援。家電的碰撞範圍由會投射陰影（`castShadow`）的零件自動算出來，新增家電模型時純視覺效果的零件不要設 `castShadow`，不然會變成擋路的牆；比角色高的（冷氣）不擋路但可以互動
- 家具：KayKit Furniture Bits（CC0），清單與位置在 `app/utils/roomFurniture.ts`，碰撞範圍是家具自己座標的外框、用 `frame` 跟著家具旋轉，斜放也不會變大（地毯、牆上的東西設 `solid: false`）。模型統一縮放 `FURNITURE_SCALE` 0.6，所有家具共用一份材質／貼圖。調整擺放時要留通道讓角色走得到每台家電，改完用前台實際點每台家電確認
- 坐、躺（前台小互動）：可互動的家具在 `ROOM_FURNITURE` 標 `interactive`，坐躺的位置寫在 `roomFurniture.ts` 的 `SEAT_SPOTS`（模型座標，座面高度用向下射線量過）。流程：走到 `approach` → 0.45 秒過場坐上去 → 方向鍵／E／點別處起身。姿勢在 `chibiCharacter.ts`（`rest: 'sit' | 'lie'`，躺下是整個身體繞髖部轉 90 度、頭朝 -Z），睡覺時閉眼、頭上飄 Zzz。只在自己的畫面，不同步給其他人、不寫資料庫。家具的互動範圍（0.6）比家電（1.2）小，兩者取最近的。**`approach` 一定要讓角色走得到**：A* 格子 0.1 公尺，兩個障礙物中間要留 0.6 公尺以上，不然會被當成走不過去
- 點擊移動用 `findPath`（`collision.ts`，網格 A* + 去掉多餘轉折點）繞過家具；找不到路時退回直線走，撞到後靠卡住偵測放棄
- 電視節目在 `app/utils/tvProgram.ts`：用 canvas 每秒畫 30 次卡通風景＋即時用電跑馬燈，當作螢幕的 `emissiveMap`；關機時把 `emissiveIntensity` 降到 0、停止重畫。螢幕照到房間的光（`statusLight`）顏色跟著節目的天色變
- 洗衣機窗口（滾筒、衣服、水、泡泡、玻璃）在 `app/utils/washerWindow.ts`，依讀數的 `wash_phase`（進水／加熱／洗滌／洗清／脫水，定義在 `WASH_CYCLE`）決定水位與轉法。窗口各層前後錯開幾公釐，不要跟機身正面放在同一個平面，會 z-fighting 出現閃爍條紋
- 家電機身一律用 `roundedBox()`（RoundedBoxGeometry），跟角色、家具的圓潤風格一致；後台也會載入 RoundedBoxGeometry 和 GLTFLoader
- **新素材先確認授權**：Fab 等平台上標「允許使用 AI：否」（NoAI）的素材，授權禁止當作生成式 AI 的輸入，Claude 不能打開或處理，改找 CC0 的
- 樣式一律用 **Tailwind CSS v4**（`@tailwindcss/vite`，沒有 tailwind.config），不寫 `<style>` 區塊；設計 token（`bg-surface`、`text-muted`、`border-line`、`text-live`/`alert`/`highlight`、`animate-live-pulse`）定義在 `app/assets/css/main.css` 的 `@theme`
- 執行期才知道的狀態色用 `:style="{ '--level-color': ... }"` 傳進去，再用 `bg-(--level-color)`、`border-l-(--level-color)` 取用
- 狀態 → 顏色／標籤的對應集中在 `app/utils/deviceVisual.ts`，3D 場景、卡片、圖表共用；canvas 上畫的顏色吃不到 CSS 變數，改色時 `@theme` 和 `LEVEL_COLORS` 兩邊都要改
- `RoomScene.vue` 的 three.js 物件都是一般變數（不放進 ref），動畫迴圈每格直接讀 props；HTML 標籤位置直接寫 style，不走 Vue 響應式

## 資料庫

`supabase/` 底下是手動維護的 SQL，沒接 Supabase CLI。改 schema 時同步更新 `supabase/schema.sql`、`server/utils/database.types.ts`（手寫型別，`Relationships` 一定要留著）、`shared/types/smartRoom.ts`，並提醒使用者自己到 SQL Editor 執行——Claude 沒有 service role key。

## 已知陷阱


- **Nuxt 自動 import 的掃描器會漏掉物件常數後面的 export**：`export const X = { min: 1, max: 2 } as const` 寫在同一行時，緊接在下一行的 `export const` 會從自動 import 清單消失（`DEVICE_THRESHOLD_RANGE`、`AC_TEMP_MIN` 都中過）。`shared/`、`utils/` 裡要被自動 import 的常數一律寫成單純的數字／字串常數；懷疑漏掉時看 `.nuxt/imports.d.ts`
- **`$fetch` 錯誤的中文訊息要從 `err.data` 拿**，不能用 `err.statusMessage`：後者是 HTTP 狀態列文字，h3 會把中文濾掉換回英文（例如 "Unauthorized"）。一律用 `app/utils/apiError.ts` 的 `apiErrorMessage()`

- **`NUXT_PUBLIC_SUPABASE_URL` 要填 Project URL（`https://xxxx.supabase.co`），不是 REST endpoint（多了 `/rest/v1/`）**：supabase-js 會自己再接一次 `/rest/v1`，貼錯會變成 `PGRST125 Invalid path specified in request URL`。`normalizeSupabaseUrl()`（前後端都有用）已經會自動去掉這段，但 `.env` 最好還是填對
- **同一個元素不要同時放兩個 border-color utility 再用條件切換**（例如固定的 `border-line` 加上條件的 `border-highlight`）：誰會生效取決於 Tailwind 產生的 CSS 順序，不是 class 的書寫順序。要用三元運算二選一
- **改了 `nuxt.config.ts` 或刪掉元件的 `<style>` 區塊後**，正在跑的 dev server 可能還會去要舊的 style 網址而噴 404／Tailwind 解析錯誤，重開 dev server 就好
- **three r186 移除了 `PCFSoftShadowMap`**：用了只會在 console 跳警告然後退回 `PCFShadowMap`
- **Chart.js linear 軸的時間刻度**：自動刻度不會對齊整點（會出現 18:59），`TimelineChart.vue` 用 `afterBuildTicks` 自己放整點刻度
- **手機版前台的頂部要保持精簡**（`md` 以下）：只有一行用電數字（瓦數／契約容量、`$電費/月`、`LiveStatus compact` 只剩圓點）＋導覽／後台按鈕。這一行很緊：4 位數瓦數在 375 寬只剩約 27px 餘裕（4 位數電費會再吃掉約 20px），375 以下省略契約容量，要加東西先用 320／360／375 寬量 `scrollWidth`，下面一列是導覽（只顯示目前這一步，點「2 / 4 ▾」展開）或今日任務（預設收合）。點房間（`RoomScene` 的 pointerdown → `sceneTaps`）會自動收合展開的清單。完整資訊框只在桌面版；手機上加新資訊前先確認不會把房間擋掉一大塊
- **手機直式畫面**：`RoomScene.vue` 依寬高比放大垂直視角，維持水平可視範圍；改鏡頭位置後要用窄螢幕確認電器沒被切掉
- **Realtime 推播的是原始資料列**：`timestamptz` 是 `+00:00` 結尾的字串、`numeric` 可能是字串，跟 API 回傳的格式不同，進 store 前要經過 `useDeviceEventStream` 的 `normalizeEvent`
- **Realtime 收不到事件**時先檢查兩件事：`device_events` 有沒有加進 `supabase_realtime` publication、anon 有沒有 select policy（Realtime 會用訂閱者身分檢查 RLS，沒有 policy 就什麼都收不到，而且不會報錯）
