-- Migrate student_held_back_years → student_grade_history (safe, non-destructive).
-- Does NOT drop or alter student_held_back_years.
--
-- For each held-back promotion_year Y:
--   academic_year = Y-(Y+1) e.g. 2026 → 2026-27
--   grade = students.grade (current cache)
--   status = repeating
--
-- ON CONFLICT DO NOTHING — never overwrite an existing Grade History row.
--
-- Manual review recommended when current grade may already be wrong after a
-- mistaken promotion. Preview first (run in SQL editor before migrate):
--
-- select s.id, s.name_zh, s.nickname_en, s.grade as current_grade, h.promotion_year,
--   (h.promotion_year::text || '-' || right((h.promotion_year + 1)::text, 2)) as academic_year,
--   'repeating' as status,
--   'Uses current students.grade as the repeating-year grade — verify manually if student was promoted after the held-back year'
--     as migration_note
-- from public.student_held_back_years h
-- join public.students s on s.id = h.student_id
-- order by h.promotion_year, s.id;
--
-- Unsafe / needs human check if:
-- - current_grade is blank
-- - student already has a grade_history row for that academic_year (ON CONFLICT DO NOTHING keeps existing)
-- - current_grade no longer matches the grade they actually repeated that year

insert into public.student_grade_history (student_id, academic_year, grade, status, note)
select
  h.student_id,
  h.promotion_year::text || '-' || right((h.promotion_year + 1)::text, 2),
  case
    when s.grade in ('F.1', 'F1') then 'F1'
    when s.grade in ('F.2', 'F2') then 'F2'
    when s.grade in ('F.3', 'F3') then 'F3'
    when s.grade in ('F.4', 'F4') then 'F4'
    when s.grade in ('F.5', 'F5') then 'F5'
    when s.grade in ('F.6', 'F6') then 'F6'
    else coalesce(nullif(trim(s.grade), ''), 'F1')
  end,
  'repeating',
  coalesce(nullif(trim(h.note), ''), 'migrated from student_held_back_years')
from public.student_held_back_years h
join public.students s on s.id = h.student_id
where h.promotion_year is not null
  and coalesce(nullif(trim(s.grade), ''), '') <> ''
on conflict (student_id, academic_year) do nothing;

-- Optional: seed current Academic Year (HK) from students.grade as normal
-- when missing. Does not invent past years.
insert into public.student_grade_history (student_id, academic_year, grade, status, note)
select
  s.id,
  case
    when extract(month from (now() at time zone 'Asia/Hong_Kong')) >= 9 then
      extract(year from (now() at time zone 'Asia/Hong_Kong'))::integer::text
      || '-'
      || right((extract(year from (now() at time zone 'Asia/Hong_Kong'))::integer + 1)::text, 2)
    else
      (extract(year from (now() at time zone 'Asia/Hong_Kong'))::integer - 1)::text
      || '-'
      || right(extract(year from (now() at time zone 'Asia/Hong_Kong'))::integer::text, 2)
  end,
  case
    when s.grade in ('F.1', 'F1') then 'F1'
    when s.grade in ('F.2', 'F2') then 'F2'
    when s.grade in ('F.3', 'F3') then 'F3'
    when s.grade in ('F.4', 'F4') then 'F4'
    when s.grade in ('F.5', 'F5') then 'F5'
    when s.grade in ('F.6', 'F6') then 'F6'
    else coalesce(nullif(trim(s.grade), ''), 'F1')
  end,
  'normal',
  'auto: seed current AY from students.grade'
from public.students s
where coalesce(nullif(trim(s.grade), ''), '') <> ''
on conflict (student_id, academic_year) do nothing;
