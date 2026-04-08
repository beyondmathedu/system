-- 房間「恆常班」同一時段可容納人數上限（用於 /regular-class-timetable 餘額顯示）
-- 在 Supabase SQL Editor 執行一次即可。

alter table public.classrooms
  add column if not exists regular_period_max smallint;

comment on column public.classrooms.regular_period_max is
  '恆常排課每時段上限（與課表 room 一致之房間名稱）；NULL 則用程式預設（B/M前=5, M後/Hope=6, Hope 2=5）。';
