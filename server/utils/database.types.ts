import type { CommandSource, DeviceKind, DeviceType, RoomPosition } from '#shared/types/smartRoom'

// 手寫對齊 supabase/schema.sql 的型別。Relationships: [] 一定要留著——
// 少了它 @supabase/postgrest-js 會讓 .from() 的型別整個退化成 never。

type DeviceRow = {
  id: string
  name: string
  kind: DeviceKind
  type: DeviceType
  room_position: RoomPosition
  power_threshold_watts: number
  sort_order: number
}

type EventRow = {
  id: number
  device_id: string
  timestamp: string
  power_on: boolean
  set_temp_c: number | null
  started_at: string | null
  source: CommandSource
  guided: boolean
}

export type Database = {
  public: {
    Tables: {
      devices: {
        Row: DeviceRow
        Insert: DeviceRow
        Update: Partial<DeviceRow>
        Relationships: []
      }
      device_events: {
        Row: EventRow
        Insert: Omit<EventRow, 'id'>
        Update: Partial<Omit<EventRow, 'id'>>
        Relationships: [
          {
            foreignKeyName: 'device_events_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'devices'
            referencedColumns: ['id']
          }
        ]
      }
      house_settings: {
        Row: { id: number; house_limit_watts: number; breaker_settled_at: string | null; tripped_at: string | null }
        Insert: { id?: number; house_limit_watts: number; breaker_settled_at?: string | null; tripped_at?: string | null }
        Update: { id?: number; house_limit_watts?: number; breaker_settled_at?: string | null; tripped_at?: string | null }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: Record<never, never>
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
