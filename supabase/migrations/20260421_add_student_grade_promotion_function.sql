-- Promote student grade levels on/after Sept 1 once per school year.
-- F1->F2, F2->F3, F3->F4, F4->F5, F5->F6. F6 is unchanged.

create table if not exists public.student_grade_promotion_runs (
  run_year integer primary key,
  promoted_count integer not null default 0,
  executed_at timestamptz not null default now()
);

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
  promotion_date date := make_date(coalesce(p_year, extract(year from (now() at time zone 'Asia/Hong_Kong'))::integer), 9, 1);
  today_hk date := (now() at time zone 'Asia/Hong_Kong')::date;
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

  update public.students s
  set grade = case s.grade
    when 'F1' then 'F2'
    when 'F2' then 'F3'
    when 'F3' then 'F4'
    when 'F4' then 'F5'
    when 'F5' then 'F6'
    else s.grade
  end
  where s.grade in ('F1', 'F2', 'F3', 'F4', 'F5');

  get diagnostics affected = row_count;

  insert into public.student_grade_promotion_runs(run_year, promoted_count)
  values (target_year, affected);

  return query
  select target_year, affected, false, false, 'Promotion completed.';
end;
$$;
