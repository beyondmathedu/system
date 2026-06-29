-- Phase B: canonical year-aware lesson state + metrics; copy legacy 2026 rows once.

create table if not exists public.student_lessons_year_metrics (
  student_id text not null references public.students(id) on delete cascade,
  year integer not null,
  remedial_count integer not null default 0,
  current_month_absent_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (student_id, year)
);

alter table public.student_lessons_year_metrics enable row level security;

drop policy if exists "allow all student_lessons_year_metrics" on public.student_lessons_year_metrics;
create policy "allow all student_lessons_year_metrics"
  on public.student_lessons_year_metrics for all using (true) with check (true);

insert into public.student_lessons_year_state (
  student_id,
  year,
  attendance,
  hidden_dates,
  overrides,
  reschedule_entries,
  extra_entries,
  updated_at
)
select
  student_id,
  2026,
  attendance,
  hidden_dates,
  overrides,
  reschedule_entries,
  extra_entries,
  updated_at
from public.student_lessons_2026_state
on conflict (student_id, year) do nothing;

insert into public.student_lessons_year_metrics (
  student_id,
  year,
  remedial_count,
  current_month_absent_count,
  updated_at
)
select
  student_id,
  2026,
  remedial_count,
  current_month_absent_count,
  updated_at
from public.student_lessons_2026_metrics
on conflict (student_id, year) do nothing;
