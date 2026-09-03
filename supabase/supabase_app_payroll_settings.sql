-- Tutor Monthly Lesson Record：全站薪金設定（一筆）
-- 在 Supabase SQL Editor 執行；或併入 supabase/supabase_student_lessons_schema.sql

create table if not exists public.app_payroll_settings (
  id smallint primary key default 1 check (id = 1),
  multi_student_first_amount numeric(10, 2) not null default 120 check (multi_student_first_amount >= 0),
  mpf_relevant_income_threshold numeric(10, 2) not null default 7100 check (mpf_relevant_income_threshold >= 0),
  updated_at timestamptz not null default now()
);

alter table public.app_payroll_settings
  add column if not exists mpf_relevant_income_threshold numeric(10, 2) not null default 7100
  check (mpf_relevant_income_threshold >= 0);

insert into public.app_payroll_settings (id, multi_student_first_amount, mpf_relevant_income_threshold)
values (1, 120, 7100)
on conflict (id) do nothing;

alter table public.app_payroll_settings enable row level security;

drop policy if exists "allow all app_payroll_settings" on public.app_payroll_settings;
create policy "allow all app_payroll_settings"
  on public.app_payroll_settings for all using (true) with check (true);
