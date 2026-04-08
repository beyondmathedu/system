-- 導師顯示用色碼（#RRGGBB）。在 Supabase SQL Editor 執行一次即可。
alter table public.tutors add column if not exists color_hex text not null default '';
