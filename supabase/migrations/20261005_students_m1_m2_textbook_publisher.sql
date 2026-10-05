-- Per-paper Maths Extended textbooks (M1/M2) for student progress workbook columns.

alter table public.students
  add column if not exists m1_textbook_publisher text,
  add column if not exists m2_textbook_publisher text;

-- Return type changed; CREATE OR REPLACE cannot alter OUT columns.
drop function if exists public.list_students_for_page(integer, integer, text, text, text, date, integer);

create or replace function public.list_students_for_page(
  p_offset integer,
  p_limit integer,
  p_q text,
  p_status text,
  p_inactive_kind text,
  p_today date,
  p_year integer
)
returns table (
  id text,
  name_zh text,
  name_en text,
  nickname_en text,
  birth_date date,
  student_phone text,
  email text,
  school text,
  textbook_publisher text,
  grade text,
  math_language text,
  takes_m1 boolean,
  takes_m2 boolean,
  m1_textbook_publisher text,
  m2_textbook_publisher text,
  total_count bigint
)
language sql
stable
as $$
  with filtered as (
    select
      s.id,
      s.name_zh,
      s.name_en,
      s.nickname_en,
      s.birth_date,
      s.student_phone,
      s.email,
      s.school,
      s.textbook_publisher,
      s.grade,
      s.math_language,
      s.takes_m1,
      s.takes_m2,
      s.m1_textbook_publisher,
      s.m2_textbook_publisher
    from public.students s
    where public.student_matches_list_status(
      s.id,
      s.grade,
      p_today,
      p_year,
      p_status,
      p_inactive_kind
    )
    and (
      coalesce(trim(p_q), '') = ''
      or s.id ilike '%' || replace(replace(replace(trim(p_q), '%', ''), '_', ''), ',', '') || '%'
      or s.name_zh ilike '%' || replace(replace(replace(trim(p_q), '%', ''), '_', ''), ',', '') || '%'
      or s.name_en ilike '%' || replace(replace(replace(trim(p_q), '%', ''), '_', ''), ',', '') || '%'
      or s.nickname_en ilike '%' || replace(replace(replace(trim(p_q), '%', ''), '_', ''), ',', '') || '%'
      or s.school ilike '%' || replace(replace(replace(trim(p_q), '%', ''), '_', ''), ',', '') || '%'
      or s.student_phone ilike '%' || replace(replace(replace(trim(p_q), '%', ''), '_', ''), ',', '') || '%'
      or s.email ilike '%' || replace(replace(replace(trim(p_q), '%', ''), '_', ''), ',', '') || '%'
    )
  ),
  counted as (
    select f.*, count(*) over () as total_count
    from filtered f
    order by f.id asc
    offset greatest(0, coalesce(p_offset, 0))
    limit greatest(1, least(200, coalesce(p_limit, 80)))
  )
  select * from counted;
$$;

comment on function public.list_students_for_page is
  'Paginated students list with active/inactive filter (mirrors studentsListServer.ts).';
