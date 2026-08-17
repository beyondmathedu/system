-- Students list perf: filter active/inactive in SQL instead of scanning all rows in Node.

create or replace function public.is_f6_grade(grade text)
returns boolean
language sql
immutable
as $$
  select upper(regexp_replace(trim(coalesce(grade, '')), '\s+', '', 'g')) ~ '^F\.?6$';
$$;

create or replace function public.student_has_manual_inactive_on_date(
  p_student_id text,
  p_date date
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.student_visibility_periods p
    where p.student_id = p_student_id
      and p.start_date <= p_date
      and (p.end_date is null or p.end_date > p_date)
  );
$$;

create or replace function public.student_temporarily_inactive_on_date(
  p_student_id text,
  p_date date
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.student_visibility_periods p
    where p.student_id = p_student_id
      and p.end_date is not null
      and p.start_date <= p_date
      and p.end_date > p_date
  );
$$;

create or replace function public.student_inactive_on_date(
  p_student_id text,
  p_grade text,
  p_date date,
  p_year integer
)
returns boolean
language sql
stable
as $$
  select public.student_has_manual_inactive_on_date(p_student_id, p_date)
    or (public.is_f6_grade(p_grade) and p_date >= make_date(p_year, 5, 1));
$$;

create or replace function public.student_matches_list_status(
  p_student_id text,
  p_grade text,
  p_date date,
  p_year integer,
  p_status text,
  p_inactive_kind text
)
returns boolean
language sql
stable
as $$
  select case
    when coalesce(p_status, 'active') = 'all' then true
    when coalesce(p_status, 'active') = 'active' then
      not public.student_inactive_on_date(p_student_id, p_grade, p_date, p_year)
    when not public.student_inactive_on_date(p_student_id, p_grade, p_date, p_year) then false
    when coalesce(p_inactive_kind, 'all') = 'temporary' then
      public.student_temporarily_inactive_on_date(p_student_id, p_date)
    when coalesce(p_inactive_kind, 'all') = 'graduated' then
      not public.student_temporarily_inactive_on_date(p_student_id, p_date)
    else true
  end;
$$;

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
      s.math_language
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

create or replace function public.next_student_id()
returns text
language sql
stable
as $$
  select lpad((coalesce(max(cast(s.id as integer)), 0) + 1)::text, 5, '0')
  from public.students s
  where s.id ~ '^\d+$';
$$;

comment on function public.list_students_for_page is
  'Paginated students list with active/inactive filter (mirrors studentsListServer.ts).';
