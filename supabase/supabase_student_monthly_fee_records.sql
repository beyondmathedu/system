-- Run in Supabase SQL Editor
--
-- 用途：
-- 為 /students-lesson-time-fee-record 儲存每位學生「每月」手填欄位：
-- - submitted_amount（已交）
-- - remarks（Remarks）
-- - send_fee（月尾Send學費）

create table if not exists public.student_monthly_fee_records (
  student_id text not null references public.students(id) on delete cascade,
  year integer not null,
  month integer not null check (month >= 1 and month <= 12),
  submitted_amount numeric(10,2) not null default 0 check (submitted_amount >= 0),
  remarks text not null default '',
  send_fee boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (student_id, year, month)
);

create index if not exists idx_student_monthly_fee_records_year_month
  on public.student_monthly_fee_records (year, month);

alter table public.student_monthly_fee_records enable row level security;

-- For internal/admin usage. Replace with stricter policies if needed.
drop policy if exists "allow all student_monthly_fee_records" on public.student_monthly_fee_records;
create policy "allow all student_monthly_fee_records"
  on public.student_monthly_fee_records
  for all
  using (true)
  with check (true);

