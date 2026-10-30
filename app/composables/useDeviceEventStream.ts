import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommandSource, DeviceEvent, HouseSettings } from '#shared/types/smartRoom'

let client: SupabaseClient | null = null

// Realtime 推播的是原始的資料列：timestamptz 是 "+00:00" 結尾的字串、numeric 可能是字串，
// 統一整理成跟 API 回傳一樣的格式，後面的比較與計算才不用處處防呆
function normalizeEvent(row: Record<string, unknown>): DeviceEvent {
  const iso = (value: unknown) => (value == null ? null : new Date(String(value)).toISOString())
  return {
    device_id: String(row.device_id),
    timestamp: iso(row.timestamp)!,
    power_on: Boolean(row.power_on),
    set_temp_c: row.set_temp_c == null ? null : Number(row.set_temp_c),
    started_at: iso(row.started_at),
    source: row.source as CommandSource,
    guided: Boolean(row.guided)
  }
}

const VISITOR_KEY = 'yongdian-xiaowu:visitor-id'

// 這個瀏覽器的訪客 id，存在 localStorage 讓所有分頁共用。讀寫失敗（無痕模式封鎖儲存空間）時
// 退回只用一次的 id，頂多同一個人被多算幾次。
// crypto.randomUUID 只有 https／localhost 能用，手機用區網 IP 連開發伺服器時要退回亂數字串
function visitorId(): string {
  const fresh = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = fresh()
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return fresh()
  }
}

export interface DeviceStreamHandlers {
  onEvent: (event: DeviceEvent) => void
  // 後台改了某台電器的閾值
  onThreshold: (deviceId: string, watts: number) => void
  // 後台改了契約容量
  onSettings: (settings: HouseSettings) => void
  onStatus: (connected: boolean) => void
  // 目前有幾個分頁開著網站（前台、後台都算，包含自己）
  onPresence: (count: number) => void
}

// 訂閱房間的所有即時變化。沒有設定 publishable key（例如記憶體模式）時回傳 null，
// 呼叫端自行退回輪詢。回傳的函式用來取消訂閱。
export function useDeviceEventStream() {
  const { supabaseUrl, supabaseKey } = useRuntimeConfig().public

  async function subscribe(handlers: DeviceStreamHandlers): Promise<(() => void) | null> {
    if (!supabaseUrl || !supabaseKey) return null
    // supabase-js 只有訂閱 Realtime 用得到，動態載入，沒設定 key 的環境就不用下載
    const { createClient } = await import('@supabase/supabase-js')
    client ??= createClient(normalizeSupabaseUrl(supabaseUrl), supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    // Presence：只同步「我在線上」，不寫資料庫、不同步角色位置。分頁關掉或斷線時，Supabase 會自動移出名單。
    // 用同一個瀏覽器的訪客 id 報到：Presence 會把同一個 key 的多條連線合併成一筆，
    // 同時開前台與後台、或開好幾個分頁都只算一人（電腦加手機還是兩人，沒登入分不出來）
    const channel = client.channel('smart-room', { config: { presence: { key: visitorId() } } })
    channel
      .on('presence', { event: 'sync' }, () => handlers.onPresence(Object.keys(channel.presenceState()).length))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'device_events' }, (payload) => {
        handlers.onEvent(normalizeEvent(payload.new))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, (payload) => {
        handlers.onThreshold(String(payload.new.id), Number(payload.new.power_threshold_watts))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'house_settings' }, (payload) => {
        if (payload.eventType === 'DELETE') return
        // timestamptz 推播過來是 +00:00 結尾的字串，轉成跟 API 一樣的 ISO 格式
        const tripped = payload.new.tripped_at as string | null
        handlers.onSettings({
          house_limit_watts: Number(payload.new.house_limit_watts),
          tripped_at: tripped ? new Date(tripped).toISOString() : null
        })
      })
      .subscribe((status) => {
        handlers.onStatus(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') channel.track({ online_at: new Date().toISOString() })
      })

    return () => {
      client?.removeChannel(channel)
    }
  }

  return { subscribe }
}
