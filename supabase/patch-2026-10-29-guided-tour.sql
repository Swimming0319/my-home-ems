-- 新手導覽：導覽中送出的指令、以及導覽示範造成的跳電，都在 device_events 標記 guided，
-- 前台「今天不要跳電」任務就不會因為有人走完導覽而失敗。
-- 在 SQL Editor 執行這個檔案一次即可（可重複執行）。只新增一個欄位，舊資料一律當作不是導覽（false）。
-- 要先執行這個檔案再部署新版程式：新版查詢 device_events 時會選 guided 欄位，沒有這個欄位會整個查詢失敗。
alter table device_events add column if not exists guided boolean not null default false;
