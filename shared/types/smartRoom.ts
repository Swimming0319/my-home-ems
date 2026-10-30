// 前後端共用的資料格式（規劃文件「API 資料格式」：一開始就定死，避免反覆調整）。
// Nuxt 4 的 shared/ 目錄會同時被 app/ 與 server/ 自動 import。

export type DeviceType = 'electricity' | 'water'

export type DeviceStatus = 'on' | 'off' | 'standby' | 'running'

export type DeviceKind = 'air_conditioner' | 'tv' | 'washer' | 'fridge' | 'microwave' | 'kettle' | 'light'

// 洗衣行程的階段：進水、加熱、洗滌、洗清、脫水
export type WashPhase = 'fill' | 'heat' | 'wash' | 'rinse' | 'spin'

export interface RoomPosition {
  x: number
  y: number
  z: number
  rotation: number
}

export interface Device {
  id: string
  name: string
  kind: DeviceKind
  type: DeviceType
  room_position: RoomPosition
  power_threshold_watts: number
}

// 讀數不存資料庫，是由 DeviceEvent 推算出來的（見 server/utils/powerModel.ts）
export interface Reading {
  device_id: string
  timestamp: string
  power_watts: number
  water_liters: number | null
  status: DeviceStatus
  set_temp_c: number | null
  // 洗衣機運轉中才有；3D 場景用它決定滾筒裡有沒有水、怎麼轉
  wash_phase: WashPhase | null
}

// system：跳電時寫的斷電事件，代表「沒有電」；auto：停電太久，伺服器自動復電時寫的事件
export type CommandSource = 'player' | 'admin' | 'system' | 'auto'

// 每次狀態改變寫一筆；兩筆事件之間家電的狀態不變
export interface DeviceEvent {
  device_id: string
  timestamp: string
  power_on: boolean
  set_temp_c: number | null
  // 這次開機（冷氣）／這輪洗衣（洗衣機）從何時開始，用來算開機高峰與洗衣行程
  started_at: string | null
  source: CommandSource
  // 新手導覽中送出的指令；跳電的斷電事件也會標記，代表這次跳電是導覽示範造成的（不算進每日任務）
  guided: boolean
}

export type CommandAction = 'power_on' | 'power_off' | 'set_temp'

export interface DeviceCommand {
  action: CommandAction
  set_temp_c?: number
  source: Exclude<CommandSource, 'system' | 'auto'>
  guided?: boolean
}

export interface CommandResult {
  changed: boolean
  // 指令執行後目前生效的事件；前端可以直接套用，不用等 Realtime 推播回來
  event: DeviceEvent | null
  reading: Reading
}

export type AlertLevel = 'normal' | 'warning' | 'alert'

export interface HouseSettings {
  house_limit_watts: number
  // 跳電中：跳電的時間點；null 代表有電。跳電後整間停電，要到電箱（或後台）復電才能再用家電
  tripped_at: string | null
}

export interface AdminSession {
  authenticated: boolean
  // 後台需不需要登入：開發模式什麼登入方式都沒設定時不需要
  loginRequired: boolean
  // 伺服器開放的登入方式：管理密碼（NUXT_ADMIN_PASSWORD）、Google（NUXT_ADMIN_EMAILS 允許名單）
  passwordLogin: boolean
  googleLogin: boolean
  // 用 Google 登入的信箱；用密碼登入或沒登入時是 null
  email: string | null
}

export interface BreakerCheckResult {
  tripped_at: string | null
}

export interface BreakerResetResult {
  // 原本就有電（例如別人已經先復電了）時是 false
  restored: boolean
}

// 一次跳電：時間點、是不是新手導覽示範造成的
export interface BreakerTrip {
  at: string
  guided: boolean
}
