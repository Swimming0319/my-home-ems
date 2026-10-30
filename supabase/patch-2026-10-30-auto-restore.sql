-- 停電自動復電：停電 5 分鐘沒人去扳總開關，伺服器會自動復電，寫的事件來源是 'auto'。
-- 在 SQL Editor 執行這個檔案一次即可（可重複執行）。只放寬 source 欄位的限制，不會動到任何資料。
-- 要先執行這個檔案再部署新版程式：沒有放寬的話，自動復電寫入事件時會被資料庫擋下來。
alter table device_events drop constraint if exists device_events_source_check;
alter table device_events add constraint device_events_source_check
  check (source in ('player', 'admin', 'system', 'auto'));
