-- Run in Supabase SQL Editor
--
-- 用途：
-- 為 /students-lesson-time-fee-record 儲存每位學生「每月」手填欄位：
-- - submitted_amount（已交）
-- - fee_pricing_grade（可選：鎖定該月用邊個 F 計價；空則自動按 9·1 反推）
-- - remarks（Remarks 欄）
-- - makeup_remarks（Makeup 彈窗備註）
-- - balance_due_remarks（Balance Due 彈窗備註）

create table if not exists public.student_monthly_fee_records (
  student_id text not null references public.students(id) on delete cascade,
  year integer not null,
  month integer not null check (month >= 1 and month <= 12),
  submitted_amount numeric(10,2) not null default 0 check (submitted_amount >= 0),
  lesson_unit_price numeric(10,2),
  fee_pricing_grade text,
  remarks text not null default '',
  makeup_remarks text not null default '',
  balance_due_remarks text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id, year, month)
);

alter table public.student_monthly_fee_records
  add column if not exists lesson_unit_price numeric(10,2);

alter table public.student_monthly_fee_records
  add column if not exists fee_pricing_grade text;

alter table public.student_monthly_fee_records
  add column if not exists makeup_remarks text not null default '';

alter table public.student_monthly_fee_records
  add column if not exists balance_due_remarks text not null default '';

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

