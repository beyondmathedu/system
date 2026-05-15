-- Editable tier tuition: F1–F3 vs F4–F6, first N lessons vs rest (default N=8).
create table if not exists public.app_student_fee_tier_settings (
  id smallint primary key default 1 check (id = 1),
  f_low_tier_1_8 numeric(10, 2) not null default 230,
  f_low_tier_9_plus numeric(10, 2) not null default 210,
  f_high_tier_1_8 numeric(10, 2) not null default 280,
  f_high_tier_9_plus numeric(10, 2) not null default 250,
  lesson_tier_break_after smallint not null default 8
    check (lesson_tier_break_after >= 1 and lesson_tier_break_after <= 24),
  updated_at timestamptz not null default now()
);

insert into public.app_student_fee_tier_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.app_student_fee_tier_settings enable row level security;

drop policy if exists "allow all app_student_fee_tier_settings" on public.app_student_fee_tier_settings;
create policy "allow all app_student_fee_tier_settings"
  on public.app_student_fee_tier_settings
  for all
  using (true)
  with check (true);

-- Optional: force pricing tier grade for this month (when auto Sept-1 back-calc is wrong).
alter table public.student_monthly_fee_records
  add column if not exists fee_pricing_grade text;

comment on column public.student_monthly_fee_records.fee_pricing_grade is
  'Optional F1–F6 override for fee tier that month; null = infer from students.grade + Sept 1 promotions.';
