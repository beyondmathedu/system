-- Sept 1 promotion: write student_grade_history for the new Academic Year.
-- Grade History wins when a row already exists for the new AY.
-- Legacy student_held_back_years still marks repeating when no history row yet.
-- Depends on: student_grade_history, student_held_back_years.

create or replace function public.run_student_grade_promotion(
  p_year integer default null,
  p_force boolean default false
)
returns table (
  run_year integer,
  promoted_count integer,
  already_run boolean,
  skipped_before_date boolean,
  message text
)
language plpgsql
as $$
declare
  target_year integer := coalesce(p_year, extract(year from (now() at time zone 'Asia/Hong_Kong'))::integer);
  promotion_date date := make_date(target_year, 9, 1);
  today_hk date := (now() at time zone 'Asia/Hong_Kong')::date;
  f6_inactive_start date := make_date(target_year, 7, 1);
  new_ay text := target_year::text || '-' || right((target_year + 1)::text, 2);
  prev_ay text := (target_year - 1)::text || '-' || right(target_year::text, 2);
  affected integer := 0;
begin
  if exists (select 1 from public.student_grade_promotion_runs r where r.run_year = target_year) then
    return query
    select target_year, 0, true, false, 'Already promoted for this year.';
    return;
  end if;

  if not p_force and today_hk < promotion_date then
    return query
    select target_year, 0, false, true, 'Skipped: promotion date not reached (Sept 1 HK time).';
    return;
  end if;

  insert into public.student_visibility_periods (student_id, start_date, end_date, note)
  select s.id,
    f6_inactive_start,
    null,
    'auto: F6 graduated ' || target_year::text
  from public.students s
  where s.grade in ('F6', 'F.6')
    and not exists (
      select 1
      from public.student_visibility_periods p
      where p.student_id = s.id
        and p.end_date is null
        and p.start_date <= f6_inactive_start
    );

  -- Snapshot previous Academic Year from current grade (never overwrite history).
  insert into public.student_grade_history (student_id, academic_year, grade, status, note)
  select
    s.id,
    prev_ay,
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
    'auto: snapshot before promotion ' || target_year::text
  from public.students s
  where coalesce(nullif(trim(s.grade), ''), '') <> ''
  on conflict (student_id, academic_year) do nothing;

  -- Students who already have new AY Grade History: sync current grade cache only.
  update public.students s
  set grade = h.grade
  from public.student_grade_history h
  where h.student_id = s.id
    and h.academic_year = new_ay
    and h.grade is distinct from s.grade;

  -- Promote F1–F5 who have no new-AY history and are not held back this year.
  update public.students s
  set grade = case s.grade
    when 'F1' then 'F2'
    when 'F2' then 'F3'
    when 'F3' then 'F4'
    when 'F4' then 'F5'
    when 'F5' then 'F6'
    else s.grade
  end
  where s.grade in ('F1', 'F2', 'F3', 'F4', 'F5')
    and not exists (
      select 1
      from public.student_grade_history gh
      where gh.student_id = s.id
        and gh.academic_year = new_ay
    )
    and not exists (
      select 1
      from public.student_held_back_years hb
      where hb.student_id = s.id
        and hb.promotion_year = target_year
    );

  get diagnostics affected = row_count;

  -- Write new AY history from post-promotion current grade (never overwrite).
  insert into public.student_grade_history (student_id, academic_year, grade, status, note)
  select
    s.id,
    new_ay,
    case
      when s.grade in ('F.1', 'F1') then 'F1'
      when s.grade in ('F.2', 'F2') then 'F2'
      when s.grade in ('F.3', 'F3') then 'F3'
      when s.grade in ('F.4', 'F4') then 'F4'
      when s.grade in ('F.5', 'F5') then 'F5'
      when s.grade in ('F.6', 'F6') then 'F6'
      else s.grade
    end,
    case
      when exists (
        select 1 from public.student_held_back_years hb
        where hb.student_id = s.id and hb.promotion_year = target_year
      ) then 'repeating'
      when s.grade in ('F2', 'F3', 'F4', 'F5', 'F6', 'F.2', 'F.3', 'F.4', 'F.5', 'F.6')
        and not exists (
          select 1 from public.student_held_back_years hb
          where hb.student_id = s.id and hb.promotion_year = target_year
        )
        then 'promoted'
      else 'normal'
    end,
    case
      when exists (
        select 1 from public.student_held_back_years hb
        where hb.student_id = s.id and hb.promotion_year = target_year
      ) then 'auto: repeating ' || new_ay
      else 'auto: promotion ' || target_year::text
    end
  from public.students s
  where coalesce(nullif(trim(s.grade), ''), '') <> ''
    and not exists (
      select 1
      from public.student_grade_history h
      where h.student_id = s.id
        and h.academic_year = new_ay
    )
  on conflict (student_id, academic_year) do nothing;

  insert into public.student_grade_promotion_runs(run_year, promoted_count)
  values (target_year, affected);

  return query
  select target_year, affected, false, false, 'Promotion completed.';
end;
$$;
