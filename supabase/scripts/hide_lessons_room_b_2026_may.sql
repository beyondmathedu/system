-- 在 Supabase SQL Editor 執行（若無法跑 node script）
-- 隱藏 2026-05 Room B 03:00 PM 指定課堂

-- 00011 鄭詠羲 Hazel (Mon 3pm B)
update public.student_lessons_2026_state
set
  hidden_dates = coalesce(hidden_dates, '{}'::jsonb) || '{"2026-05-04":true,"2026-05-11":true,"2026-05-18":true,"2026-05-25":true}'::jsonb,
  updated_at = now()
where student_id = '00011';

insert into public.student_lessons_year_state (student_id, year, hidden_dates, updated_at)
values (
  '00011',
  2026,
  '{"2026-05-04":true,"2026-05-11":true,"2026-05-18":true,"2026-05-25":true}'::jsonb,
  now()
)
on conflict (student_id, year) do update
set
  hidden_dates = coalesce(student_lessons_year_state.hidden_dates, '{}'::jsonb)
    || '{"2026-05-04":true,"2026-05-11":true,"2026-05-18":true,"2026-05-25":true}'::jsonb,
  updated_at = now();

-- 00013 葉昕林
update public.student_lessons_2026_state
set
  hidden_dates = coalesce(hidden_dates, '{}'::jsonb) || '{"2026-05-04":true,"2026-05-13":true,"2026-05-20":true,"2026-05-27":true}'::jsonb,
  updated_at = now()
where student_id = '00013';

insert into public.student_lessons_year_state (student_id, year, hidden_dates, updated_at)
values (
  '00013',
  2026,
  '{"2026-05-04":true,"2026-05-13":true,"2026-05-20":true,"2026-05-27":true}'::jsonb,
  now()
)
on conflict (student_id, year) do update
set
  hidden_dates = coalesce(student_lessons_year_state.hidden_dates, '{}'::jsonb)
    || '{"2026-05-04":true,"2026-05-13":true,"2026-05-20":true,"2026-05-27":true}'::jsonb,
  updated_at = now();

-- 00058 羅富勻 Edwin
update public.student_lessons_2026_state
set
  hidden_dates = coalesce(hidden_dates, '{}'::jsonb) || '{"2026-05-04":true,"2026-05-13":true,"2026-05-20":true,"2026-05-27":true}'::jsonb,
  updated_at = now()
where student_id = '00058';

insert into public.student_lessons_year_state (student_id, year, hidden_dates, updated_at)
values (
  '00058',
  2026,
  '{"2026-05-04":true,"2026-05-13":true,"2026-05-20":true,"2026-05-27":true}'::jsonb,
  now()
)
on conflict (student_id, year) do update
set
  hidden_dates = coalesce(student_lessons_year_state.hidden_dates, '{}'::jsonb)
    || '{"2026-05-04":true,"2026-05-13":true,"2026-05-20":true,"2026-05-27":true}'::jsonb,
  updated_at = now();

-- 00192 譚凱恩 Angela
update public.student_lessons_2026_state
set
  hidden_dates = coalesce(hidden_dates, '{}'::jsonb) || '{"2026-05-13":true,"2026-05-20":true,"2026-05-27":true}'::jsonb,
  updated_at = now()
where student_id = '00192';

insert into public.student_lessons_year_state (student_id, year, hidden_dates, updated_at)
values (
  '00192',
  2026,
  '{"2026-05-13":true,"2026-05-20":true,"2026-05-27":true}'::jsonb,
  now()
)
on conflict (student_id, year) do update
set
  hidden_dates = coalesce(student_lessons_year_state.hidden_dates, '{}'::jsonb)
    || '{"2026-05-13":true,"2026-05-20":true,"2026-05-27":true}'::jsonb,
  updated_at = now();
