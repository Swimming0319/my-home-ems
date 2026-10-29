-- 第 4 階段：可在後台調整的契約容量、跳電機制、閾值／契約容量的即時同步。
-- 已經跑過 schema.sql（或之前的 patch）的環境，在 SQL Editor 執行這個檔案一次即可（可重複執行）。
-- Supabase 看到 drop 會跳「destructive operations」警告：這裡 drop 的只有索引與 policy，不會刪任何資料。

-- 全屋設定只有一列（id 固定為 1）
create table if not exists house_settings (
  id int primary key default 1 check (id = 1),
  house_limit_watts numeric not null default 3000,
  -- 跳電已經結算到這個時間點；改契約容量時更新，新的容量才不會被追溯套用到改之前的時段
  breaker_settled_at timestamptz
);
insert into house_settings (id, house_limit_watts) values (1, 3000) on conflict (id) do nothing;

-- 同一台電器同一個時間點只能有一筆事件：兩個請求同時偵測到同一次跳電時，第二筆會被略過。
-- 這個 unique 索引同時也能服務原本的範圍查詢，舊的一般索引就不需要了
create unique index if not exists device_events_device_time_key on device_events (device_id, "timestamp");
drop index if exists device_events_device_time_idx;

-- 設定與電器清單本來就是公開資訊，開放 anon 唯讀，讓前端能即時收到閾值／契約容量的變更；
-- 寫入仍然只能經過 Nuxt server routes（secret key）
alter table house_settings enable row level security;
drop policy if exists "public read devices" on devices;
create policy "public read devices" on devices for select to anon, authenticated using (true);
drop policy if exists "public read house_settings" on house_settings;
create policy "public read house_settings" on house_settings for select to anon, authenticated using (true);

do $$
declare
  t text;
begin
  foreach t in array array['devices', 'house_settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end
$$;
