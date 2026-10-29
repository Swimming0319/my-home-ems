-- 電箱：跳電後整間停電，要到電箱（或後台）復電才能再用家電。
-- 在 SQL Editor 執行這個檔案一次即可（可重複執行）。只新增一個欄位，不會動到任何資料。

-- 跳電中：跳電的時間點；復電後清成 null。house_settings 已經在 Realtime publication 裡，改了會即時推播
alter table house_settings add column if not exists tripped_at timestamptz;
