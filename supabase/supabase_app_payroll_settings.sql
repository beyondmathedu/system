-- Tutor Monthly Lesson Record：多人同一時段「第一席位」金額（全站一筆）
-- 在 Supabase SQL Editor 執行；或併入 supabase/supabase_student_lessons_schema.sql

create table if not exists public.app_payroll_settings (
  id smallint primary key default 1 check (id = 1),
  multi_student_first_amount numeric(10, 2) not null default 120 check (multi_student_first_amount >= 0),
  updated_at timestamptz not null default now()
);

insert into public.app_payroll_settings (id, multi_student_first_amount)
values (1, 120)
on conflict (id) do nothing;

alter table public.app_payroll_settings enable row level security;

drop policy if exists "allow all app_payroll_settings" on public.app_payroll_settings;
create policy "allow all app_payroll_settings"
  on public.app_payroll_settings for all using (true) with check (true);
