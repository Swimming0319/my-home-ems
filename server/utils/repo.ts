import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Device, DeviceEvent, HouseSettings } from '#shared/types/smartRoom'
import { DEFAULT_HOUSE_LIMIT_WATTS } from '#shared/utils/alerts'
import type { Database } from './database.types'

export interface StoredSettings extends HouseSettings {
  // 跳電已經結算到這個時間點；改契約容量時設成「現在」，新的容量才不會被追溯套用到改之前的時段
  breaker_settled_at: string | null
}

// 資料存取層。有設定 Supabase 就讀寫 Postgres；沒設定就退回記憶體模式，
// 讓專案 clone 下來不用先開 Supabase 專案也能直接 `npm run dev` 看到畫面。

export interface Repo {
  kind: 'supabase' | 'memory'
  listDevices(): Promise<Device[]>
  getDevice(id: string): Promise<Device | null>
  // at 當下（含）最後一筆事件，也就是那個時間點家電處於什麼狀態
  latestEvent(deviceId: string, at: Date): Promise<DeviceEvent | null>
  // (from, to] 之間的事件，依時間排序
  listEvents(deviceId: string, from: Date, to: Date): Promise<DeviceEvent[]>
  insertEvent(event: DeviceEvent): Promise<void>
  // 跳電時一次寫入多筆；同一台電器同一個時間點已經有事件就略過（兩個請求同時偵測到同一次跳電）
  insertEventsIgnoringDuplicates(events: DeviceEvent[]): Promise<void>
  // 最後一次跳電（source = system）的事件
  latestSystemEvent(): Promise<DeviceEvent | null>
  // [from, to] 之間每次跳電的時間點（一次跳電每台家電各一筆 system 事件，這裡合併成一個時間點）
  // 每次跳電一筆（同一次跳電每台家電各有一筆斷電事件，合併成一筆）
  listTrips(from: Date, to: Date): Promise<{ at: number; guided: boolean }[]>
  updateDeviceThreshold(id: string, watts: number): Promise<Device | null>
  getSettings(): Promise<StoredSettings>
  updateSettings(settings: StoredSettings): Promise<StoredSettings>
}

// 記憶體模式用的電器清單，內容（含順序，對應 sort_order）要跟 supabase/schema.sql 最下面的 insert 保持一致。
export const SEED_DEVICES: Device[] = [
  { id: 'ac', name: '冷氣', kind: 'air_conditioner', type: 'electricity', room_position: { x: 0, y: 2.3, z: -2.85, rotation: 0 }, power_threshold_watts: 1300 },
  { id: 'tv', name: '電視', kind: 'tv', type: 'electricity', room_position: { x: -2.7, y: 0, z: 0.4, rotation: Math.PI / 2 }, power_threshold_watts: 150 },
  { id: 'washer', name: '洗衣機', kind: 'washer', type: 'water', room_position: { x: 2.2, y: 0, z: -2.2, rotation: 0 }, power_threshold_watts: 1500 },
  { id: 'fridge', name: '冰箱', kind: 'fridge', type: 'electricity', room_position: { x: 4.55, y: 0, z: -2.62, rotation: 0 }, power_threshold_watts: 300 },
  { id: 'microwave', name: '微波爐', kind: 'microwave', type: 'electricity', room_position: { x: 3.15, y: 0, z: -2.7, rotation: 0 }, power_threshold_watts: 1600 },
  { id: 'kettle', name: '熱水壺', kind: 'kettle', type: 'electricity', room_position: { x: 3.85, y: 0, z: -2.7, rotation: 0 }, power_threshold_watts: 2000 },
  { id: 'light_living', name: '客廳燈', kind: 'light', type: 'electricity', room_position: { x: -2.95, y: 2.15, z: 1.75, rotation: Math.PI / 2 }, power_threshold_watts: 30 },
  { id: 'light_bedroom', name: '臥室燈', kind: 'light', type: 'electricity', room_position: { x: -1.15, y: 2.15, z: -2.95, rotation: 0 }, power_threshold_watts: 30 }
]

function uniqueTrips(rows: { at: number; guided: boolean }[]): { at: number; guided: boolean }[] {
  const byTime = new Map(rows.map((row) => [row.at, row]))
  return [...byTime.values()].sort((a, b) => a.at - b.at)
}

export function createMemoryRepo(seed: Device[] = SEED_DEVICES): Repo {
  // 複製一份，後台改閾值時才不會改到共用的 SEED_DEVICES
  const devices = seed.map((device) => ({ ...device }))
  const events = new Map<string, DeviceEvent[]>(devices.map((device) => [device.id, []]))
  let settings: StoredSettings = { house_limit_watts: DEFAULT_HOUSE_LIMIT_WATTS, breaker_settled_at: null, tripped_at: null }

  return {
    kind: 'memory',
    async listDevices() {
      return devices
    },
    async getDevice(id) {
      return devices.find((device) => device.id === id) ?? null
    },
    async latestEvent(deviceId, at) {
      const atIso = at.toISOString()
      const list = events.get(deviceId) ?? []
      return list.findLast((e) => e.timestamp <= atIso) ?? null
    },
    async listEvents(deviceId, from, to) {
      const fromIso = from.toISOString()
      const toIso = to.toISOString()
      return (events.get(deviceId) ?? []).filter((e) => e.timestamp > fromIso && e.timestamp <= toIso)
    },
    async insertEvent(event) {
      const list = events.get(event.device_id)
      if (!list) throw new Error(`unknown device ${event.device_id}`)
      list.push(event)
      list.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    },
    async insertEventsIgnoringDuplicates(rows) {
      for (const row of rows) {
        const list = events.get(row.device_id) ?? []
        if (!list.some((e) => e.timestamp === row.timestamp)) await this.insertEvent(row)
      }
    },
    async latestSystemEvent() {
      const all = [...events.values()].flat().filter((e) => e.source === 'system')
      return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1) ?? null
    },
    async listTrips(from, to) {
      const rows = [...events.values()]
        .flat()
        .filter((e) => e.source === 'system')
        .map((e) => ({ at: Date.parse(e.timestamp), guided: e.guided }))
        .filter((t) => t.at >= from.getTime() && t.at <= to.getTime())
      return uniqueTrips(rows)
    },
    async updateDeviceThreshold(id, watts) {
      const device = devices.find((d) => d.id === id)
      if (!device) return null
      device.power_threshold_watts = watts
      return device
    },
    async getSettings() {
      return settings
    },
    async updateSettings(next) {
      settings = { ...next }
      return settings
    }
  }
}

const DEVICE_COLUMNS = 'id, name, kind, type, room_position, power_threshold_watts'
const EVENT_COLUMNS = 'device_id, timestamp, power_on, set_temp_c, started_at, source, guided'
const SETTINGS_COLUMNS = 'house_limit_watts, breaker_settled_at, tripped_at'

export function createSupabaseRepo(client: SupabaseClient<Database>): Repo {
  return {
    kind: 'supabase',
    async listDevices() {
      const { data, error } = await client.from('devices').select(DEVICE_COLUMNS).order('sort_order').order('id')
      if (error) throw error
      return data
    },
    async getDevice(id) {
      const { data, error } = await client.from('devices').select(DEVICE_COLUMNS).eq('id', id).maybeSingle()
      if (error) throw error
      return data
    },
    async latestEvent(deviceId, at) {
      const { data, error } = await client
        .from('device_events')
        .select(EVENT_COLUMNS)
        .eq('device_id', deviceId)
        .lte('timestamp', at.toISOString())
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
    async listEvents(deviceId, from, to) {
      // 事件只在有人操作時才寫入，一天頂多幾十筆，用不到分頁；
      // 但 PostgREST 預設單次上限 1000 筆，被灌爆時至少不會整個查詢失敗
      const { data, error } = await client
        .from('device_events')
        .select(EVENT_COLUMNS)
        .eq('device_id', deviceId)
        .gt('timestamp', from.toISOString())
        .lte('timestamp', to.toISOString())
        .order('timestamp', { ascending: true })
      if (error) throw error
      return data
    },
    async insertEvent(event) {
      const { error } = await client.from('device_events').insert(event)
      if (error) throw error
    },
    async insertEventsIgnoringDuplicates(rows) {
      if (rows.length === 0) return
      const { error } = await client
        .from('device_events')
        .upsert(rows, { onConflict: 'device_id,timestamp', ignoreDuplicates: true })
      if (error) throw error
    },
    async latestSystemEvent() {
      const { data, error } = await client
        .from('device_events')
        .select(EVENT_COLUMNS)
        .eq('source', 'system')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
    async listTrips(from, to) {
      const { data, error } = await client
        .from('device_events')
        .select('timestamp, guided')
        .eq('source', 'system')
        .gte('timestamp', from.toISOString())
        .lte('timestamp', to.toISOString())
        .order('timestamp')
      if (error) throw error
      return uniqueTrips(data.map((row) => ({ at: Date.parse(row.timestamp), guided: row.guided })))
    },
    async updateDeviceThreshold(id, watts) {
      const { data, error } = await client
        .from('devices')
        .update({ power_threshold_watts: watts })
        .eq('id', id)
        .select(DEVICE_COLUMNS)
        .maybeSingle()
      if (error) throw error
      return data
    },
    async getSettings() {
      const { data, error } = await client
        .from('house_settings')
        .select(SETTINGS_COLUMNS)
        .eq('id', 1)
        .maybeSingle()
      if (error) throw error
      return data ?? { house_limit_watts: DEFAULT_HOUSE_LIMIT_WATTS, breaker_settled_at: null, tripped_at: null }
    },
    async updateSettings(next) {
      const { data, error } = await client
        .from('house_settings')
        .upsert({ id: 1, ...next })
        .select(SETTINGS_COLUMNS)
        .single()
      if (error) throw error
      return data
    }
  }
}

let repo: Repo | null = null

export function useRepo(): Repo {
  if (repo) return repo
  const config = useRuntimeConfig()
  if (config.public.supabaseUrl && config.supabaseServiceKey) {
    const url = normalizeSupabaseUrl(config.public.supabaseUrl)
    repo = createSupabaseRepo(createClient<Database>(url, config.supabaseServiceKey, { auth: { persistSession: false } }))
  } else {
    console.warn('[repo] 沒有設定 Supabase，改用記憶體模式（伺服器重啟後狀態與歷史會清空）')
    repo = createMemoryRepo()
  }
  return repo
}
