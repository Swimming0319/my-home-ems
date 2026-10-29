-- 擴充房間：廚房角落（冰箱、微波爐、熱水壺）與兩盞電燈。
-- 已經跑過 schema.sql 的環境，在 SQL Editor 執行這個檔案一次即可（可重複執行）。
-- Supabase 看到 drop 會跳「destructive operations」警告：這裡 drop 的只是家電種類的檢查限制，馬上會加回新的，不會刪任何資料。

-- 後台、圖表列出電器的順序
alter table devices add column if not exists sort_order int not null default 0;

alter table devices drop constraint if exists devices_kind_check;
alter table devices add constraint devices_kind_check
  check (kind in ('air_conditioner', 'tv', 'washer', 'fridge', 'microwave', 'kettle', 'light'));

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
