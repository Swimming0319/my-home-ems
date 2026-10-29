-- 用電小屋 — database schema（smart-room-spec.md「資料模型」）
-- 在 Supabase 後台 → SQL Editor 執行一次即可，可重複執行。
-- Supabase 看到 drop 會跳「destructive operations」警告：這裡 drop 的只有索引與 policy，不會刪任何資料。
--
-- 用電讀數不存表：家電耗電只取決於「目前狀態 + 經過多久」，所以只在狀態改變時
-- 寫一筆 device_events，圖表要的讀數由 shared/utils/powerModel.ts 查詢時推算。

create table if not exists devices (
  id text primary key,
  name text not null,
  kind text not null,
  type text not null check (type in ('electricity', 'water')),
  room_position jsonb not null,
  power_threshold_watts numeric not null,
  -- 後台、圖表列出電器的順序
  sort_order int not null default 0
);

-- 舊環境補欄位、更新家電種類的限制（加了廚房家電與電燈）
alter table devices add column if not exists sort_order int not null default 0;
alter table devices drop constraint if exists devices_kind_check;
alter table devices add constraint devices_kind_check
  check (kind in ('air_conditioner', 'tv', 'washer', 'fridge', 'microwave', 'kettle', 'light'));

create table if not exists device_events (
  id bigint generated always as identity primary key,
  device_id text not null references devices(id) on delete cascade,
  "timestamp" timestamptz not null,
  power_on boolean not null,
  set_temp_c numeric,
  started_at timestamptz,
  source text not null check (source in ('player', 'admin', 'system')),
  -- 新手導覽中送出的指令；跳電的斷電事件也會標記，代表這次跳電是導覽示範造成的（不算進每日任務）
  guided boolean not null default false
);

-- 舊環境補欄位（新手導覽）
alter table device_events add column if not exists guided boolean not null default false;

-- 全屋設定只有一列（id 固定為 1）
create table if not exists house_settings (
  id int primary key default 1 check (id = 1),
  house_limit_watts numeric not null default 3000,
  -- 跳電已經結算到這個時間點；改契約容量時更新，新的容量才不會被追溯套用到改之前的時段
  breaker_settled_at timestamptz,
  -- 跳電中：跳電的時間點；復電後清成 null
  tripped_at timestamptz
);
alter table house_settings add column if not exists tripped_at timestamptz;

-- 兩種查詢都靠這個索引：「某台電器某段時間範圍內的事件」與「某個時間點之前最後一筆事件」。
-- 設成 unique：兩個請求同時偵測到同一次跳電時，第二筆斷電事件會被略過
create unique index if not exists device_events_device_time_key on device_events (device_id, "timestamp");
drop index if exists device_events_device_time_idx;

-- 全部開放 anon 唯讀：這是全站共用、不需登入的房間，電器清單、設定、事件紀錄本來就公開，
-- 瀏覽器要用 publishable key 訂閱 Realtime。寫入只能經過 Nuxt server routes（secret key，會略過 RLS）
alter table devices enable row level security;
alter table device_events enable row level security;
alter table house_settings enable row level security;
drop policy if exists "public read devices" on devices;
create policy "public read devices" on devices for select to anon, authenticated using (true);
drop policy if exists "public read device_events" on device_events;
create policy "public read device_events" on device_events for select to anon, authenticated using (true);
drop policy if exists "public read house_settings" on house_settings;
create policy "public read house_settings" on house_settings for select to anon, authenticated using (true);

-- Postgres Changes 只會推播有加進 supabase_realtime publication 的表；重複 add 會報錯，所以先檢查
do $$
declare
  t text;
begin
  foreach t in array array['devices', 'device_events', 'house_settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end
$$;

insert into house_settings (id, house_limit_watts) values (1, 3000) on conflict (id) do nothing;

-- 重複執行時只更新模型相關欄位；閾值可能已經在後台調整過，不覆蓋
insert into devices (id, name, kind, type, room_position, power_threshold_watts, sort_order) values
  ('ac', '冷氣', 'air_conditioner', 'electricity', '{"x": 0, "y": 2.3, "z": -2.85, "rotation": 0}', 1300, 1),
  ('tv', '電視', 'tv', 'electricity', '{"x": -2.7, "y": 0, "z": 0.4, "rotation": 1.5708}', 150, 2),
  ('washer', '洗衣機', 'washer', 'water', '{"x": 2.2, "y": 0, "z": -2.2, "rotation": 0}', 1500, 3),
  ('fridge', '冰箱', 'fridge', 'electricity', '{"x": 4.55, "y": 0, "z": -2.62, "rotation": 0}', 300, 4),
  ('microwave', '微波爐', 'microwave', 'electricity', '{"x": 3.15, "y": 0, "z": -2.7, "rotation": 0}', 1600, 5),
  ('kettle', '熱水壺', 'kettle', 'electricity', '{"x": 3.85, "y": 0, "z": -2.7, "rotation": 0}', 2000, 6),
  ('light_living', '客廳燈', 'light', 'electricity', '{"x": -2.95, "y": 2.15, "z": 1.75, "rotation": 1.5708}', 30, 7),
  ('light_bedroom', '臥室燈', 'light', 'electricity', '{"x": -1.15, "y": 2.15, "z": -2.95, "rotation": 0}', 30, 8)
on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  type = excluded.type,
  room_position = excluded.room_position,
  sort_order = excluded.sort_order;
