# 用電小屋

全站共用一間 3D 小屋：前台操控角色使用家電，後台即時監控用電、接近上限時警示，也能遠端控制。規劃與建置進度見 [smart-room-spec.md](smart-room-spec.md)。

Nuxt 4 + TypeScript + Pinia + Tailwind CSS v4 + Three.js + Chart.js，資料庫 Supabase（Postgres），部署 Vercel。

## 快速開始

```sh
npm install
npm run dev        # http://localhost:3010
npm test           # Vitest：用電模型、指令驗證、警示規則、資料存取
```

**不設定 Supabase 也能直接跑**：後端偵測到 `NUXT_PUBLIC_SUPABASE_URL`／`NUXT_SUPABASE_SERVICE_KEY` 沒填時會改用記憶體模式，狀態與歷史在伺服器重啟後清空。

| 頁面 | 說明 |
|---|---|
| `/` | 前台：操控角色在房間裡走動，走到家電旁邊使用（WASD／方向鍵、點地板走過去、靠近家電按 E 或點「使用」） |
| `/?hour=21.5` | 前台固定在某個時間（預覽晚上、傍晚的樣子；後台也支援） |
| `/character` | 角色預覽：切換待機／走路／拿遙控器／蹲下，網址可指定 `?pose=remote&angle=-30` |
| `/admin` | 後台：全屋用電、警示紀錄、24 小時用電曲線與倒帶。沒登入是訪客模式（唯讀）；登入後才能遠端控制家電、遠端復電、調整閾值與契約容量 |

兩個頁面同時開著，在任一邊操作家電，另一邊會即時同步。

## 接上 Supabase

1. 在 Supabase 後台 → SQL Editor 執行 [supabase/schema.sql](supabase/schema.sql)（建表、索引、RLS、Realtime、8 台電器的初始資料；可重複執行）。已經跑過舊版 schema 的環境，改執行 `supabase/patch-*.sql` 補上差異
2. 複製 `.env.example` 成 `.env`，填入三個值（Project Settings → API Keys）：
   - `NUXT_PUBLIC_SUPABASE_URL`：Project URL，`https://xxxx.supabase.co`，**不要**填結尾多了 `/rest/v1/` 的 REST endpoint
   - `NUXT_SUPABASE_SERVICE_KEY`：secret key，只在伺服器端使用
   - `NUXT_PUBLIC_SUPABASE_KEY`：publishable key，給瀏覽器訂閱 Realtime；沒填的話前端退回每 10 秒輪詢
   - `NUXT_ADMIN_PASSWORD`：後台管理密碼。`npm run dev` 時沒填就不需要登入（直接有管理權限）；正式環境沒填的話沒有人能登入，後台只剩訪客模式
3. 重開 `npm run dev`，終端機不再出現「改用記憶體模式」的警告、頁面顯示「即時同步中」就代表都接上了

## 資料怎麼流動

```
POST /api/devices/:id/commands ──▶ 驗證指令 ──▶ 寫入 device_events（狀態有改變才寫）
                                                   │
                                                   ▼ Supabase Realtime 推播新事件
前台／後台：收到事件 → 更新「目前生效的事件」→ 每秒用 readingFromEvent 推算即時讀數
GET  /api/devices/:id/readings ──▶ 讀出事件 ──▶ 由「狀態 + 經過時間」推算 24 小時歷史讀數
```

用電讀數不存資料庫：家電耗電只取決於當下狀態與經過多久（冷氣開機高峰、洗衣行程），所以只在狀態改變時記一筆事件，查詢時才把讀數算出來。用電模型放在 `shared/utils/powerModel.ts`，前後端共用——洗衣行程切換這類「時間到了自己變化」的狀態不會產生事件，前端要自己推算。警示紀錄也是由歷史讀數推算，不另外存表。詳細的用電模型與警示規則見規劃文件。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/devices` | 電器清單（含 `room_position`、`power_threshold_watts`） |
| GET | `/api/devices/:id/readings?range=24h` | 時間範圍內的讀數，依時間排序；`range` 支援 `m`/`h`/`d`，最長 `7d` |
| GET | `/api/events/latest` | 每台電器目前生效的事件 |
| POST | `/api/devices/:id/commands` | 操作家電，每個 IP 每分鐘最多 30 次；`source: "admin"` 需要登入；新手導覽中帶 `guided: true` |
| PATCH | `/api/devices/:id` | 改閾值 `{ power_threshold_watts }`（需要登入） |
| GET／PATCH | `/api/settings` | 讀取契約容量與停電狀態 `{ house_limit_watts, tripped_at }`；PATCH 修改契約容量（需要登入） |
| POST | `/api/breaker/check` | 結算跳電，回傳 `{ tripped_at }`；公開、可重複呼叫 |
| GET | `/api/breaker/trips` | 過去 24 小時的每次跳電（`{ at, guided }` 陣列；`guided` 是新手導覽示範造成的，不算進每日任務） |
| POST | `/api/breaker/reset` | 復電 `{ source: 'player' \| 'admin' }`，回傳 `{ restored }`；admin 需要登入 |
| GET／POST | `/api/admin/session`、`/api/admin/login`、`/api/admin/logout` | 後台登入狀態（每個 IP 每分鐘最多試 5 次密碼） |

指令格式：

```jsonc
{ "action": "power_on" | "power_off" | "set_temp", "set_temp_c": 24, "source": "player" | "admin" }
```

- 冷氣溫度 20–30°C 整數；關機時也能先設定溫度
- 洗衣機的 `power_on` 是啟動一輪 60 分鐘的洗衣行程，洗完自動回到待機
- 狀態沒有改變（已經開機又按開機）回傳 `changed: false`，不寫入事件

讀數格式（[shared/types/smartRoom.ts](shared/types/smartRoom.ts)）：

```ts
{ device_id, timestamp, power_watts, water_liters, status, set_temp_c, wash_phase }[]
```

## 素材

- 角色：自製 Q 版角色（`app/utils/chibiCharacter.ts`），沒有使用外部模型
- 家電：自製（`RoomScene.vue` 的 builder），圓角方塊組成
- 家具：[KayKit Furniture Bits](https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0)（Kay Lousberg，CC0），只放用到的模型在 `public/models/furniture/`，擺放位置在 `app/utils/roomFurniture.ts`。**不要用標了「不允許使用 AI」（NoAI）的素材**，授權禁止把它們交給 AI 處理

## 部署到 Vercel

- 環境變數：`NUXT_PUBLIC_SUPABASE_URL`、`NUXT_SUPABASE_SERVICE_KEY`、`NUXT_PUBLIC_SUPABASE_KEY`、`NUXT_ADMIN_PASSWORD`
- Supabase 專案建在東京的話，Vercel functions 的區域也要設在東京附近，不然每次查詢都要繞一趟美國
- **一定要設定 `NUXT_ADMIN_PASSWORD`**，而且用夠長的隨機密碼：登入 cookie 的加密金鑰是從這組密碼衍生的
