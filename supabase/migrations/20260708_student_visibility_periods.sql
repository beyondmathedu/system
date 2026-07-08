-- Multiple inactive periods per student (pause history).
-- New canonical source for inactive logic across the app.

create table if not exists public.student_visibility_periods (
  id bigserial primary key,
  student_id text not null references public.students(id) on delete cascade,
  start_date date not null,
  -- end_date is the first day the student becomes Active again (half-open interval).
  -- null means indefinite pause.
  end_date date,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_visibility_periods_end_after_start check (end_date is null or end_date > start_date)
);

create index if not exists idx_student_visibility_periods_student_start_desc
  on public.student_visibility_periods (student_id, start_date desc);

create index if not exists idx_student_visibility_periods_student_end
  on public.student_visibility_periods (student_id, end_date);

comment on table public.student_visibility_periods is
  'Multiple inactive periods per student. A date is inactive if it falls within any [start_date, end_date) interval.';

comment on column public.student_visibility_periods.end_date is
  'First day the student becomes Active again; treated as exclusive end in [start_date, end_date).';

alter table public.student_visibility_periods enable row level security;

-- Keep consistent with existing admin/internal tables (allow all).
drop policy if exists "allow all student_visibility_periods" on public.student_visibility_periods;
create policy "allow all student_visibility_periods"
  on public.student_visibility_periods for all using (true) with check (true);

-- Backfill: convert legacy single-row inactive mode into one period.
insert into public.student_visibility_periods (student_id, start_date, end_date, note)
select
  svm.student_id,
  svm.effective_date as start_date,
  svm.reactivate_date as end_date,
  'backfill: student_visibility_modes'
from public.student_visibility_modes svm
where svm.mode = 'inactive'
on conflict do nothing;

