-- Seed 2026 留班 for 何焯傑 Elvin + 朱翠頤 Ashley.
-- Run AFTER supabase_student_held_back_years.sql
-- Then run supabase_migrate_held_back_to_grade_history.sql to copy into Grade History.
-- promotion_year 2026 = skip 2026-09-01 promotion (stay same form for 2026/9–2027/8).

insert into public.student_held_back_years (student_id, promotion_year, note)
select s.id, 2026, '2026学年留班'
from public.students s
where
  s.name_zh like '%何焯傑%'
  or s.name_zh like '%朱翠頤%'
  or (s.nickname_en ilike '%elvin%' and s.name_zh like '%何%')
  or (s.nickname_en ilike '%ashley%' and s.name_zh like '%朱翠頤%')
on conflict (student_id, promotion_year) do update
set note = excluded.note,
    updated_at = now();

-- Preview who was marked:
-- select s.id, s.name_zh, s.nickname_en, s.grade, h.promotion_year, h.note
-- from public.student_held_back_years h
-- join public.students s on s.id = h.student_id
-- where h.promotion_year = 2026;

-- IMPORTANT: If 2026 promotion already ran and these students were wrongly
-- promoted one level, manually set students.grade back one level in Students
-- page (or SQL). Held-back only skips future promotions + corrects month
-- rollback when current grade is already correct.
