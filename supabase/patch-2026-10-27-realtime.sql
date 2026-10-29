-- 第 2 階段：讓瀏覽器能用 publishable（anon）key 訂閱 device_events 的新增事件。
-- 已經跑過 schema.sql 的環境，在 SQL Editor 執行這個檔案一次即可（可重複執行）。

-- Postgres Changes 只會推播「有加進 supabase_realtime publication」的表；
-- 重複 add 會報錯，所以先檢查
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'device_events'
  ) then
    alter publication supabase_realtime add table device_events;
  end if;
end
$$;

-- Realtime 推播前會用訂閱者的身分檢查 RLS，沒有 select policy 的話 anon 什麼都收不到。
-- 這是全站共用、不需登入的房間，事件紀錄本來就是公開的，所以開放唯讀；
-- 寫入仍然只能經過 Nuxt server routes（secret key），anon 沒有 insert/update/delete 權限。
drop policy if exists "public read device_events" on device_events;
create policy "public read device_events" on device_events
  for select to anon, authenticated using (true);
