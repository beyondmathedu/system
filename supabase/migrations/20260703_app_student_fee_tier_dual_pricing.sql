-- Legacy (existing students) + current (new students / post switch) tier prices.
alter table public.app_student_fee_tier_settings
  add column if not exists current_f_low_tier_1_8 numeric(10, 2) not null default 270,
  add column if not exists current_f_low_tier_9_plus numeric(10, 2) not null default 250,
  add column if not exists current_f_high_tier_1_8 numeric(10, 2) not null default 320,
  add column if not exists current_f_high_tier_9_plus numeric(10, 2) not null default 300,
  add column if not exists current_price_student_ids text not null default '',
  add column if not exists global_price_switch_date date not null default '2026-09-01';

update public.app_student_fee_tier_settings
set
  current_f_low_tier_1_8 = coalesce(nullif(current_f_low_tier_1_8, 0), 270),
  current_f_low_tier_9_plus = coalesce(nullif(current_f_low_tier_9_plus, 0), 250),
  current_f_high_tier_1_8 = coalesce(nullif(current_f_high_tier_1_8, 0), 320),
  current_f_high_tier_9_plus = coalesce(nullif(current_f_high_tier_9_plus, 0), 300),
  global_price_switch_date = coalesce(global_price_switch_date, '2026-09-01'::date)
where id = 1;

comment on column public.app_student_fee_tier_settings.f_low_tier_1_8 is
  'Legacy F1–F3 normal (1..N lessons) for students not in current_price_student_ids until global switch.';
comment on column public.app_student_fee_tier_settings.current_f_low_tier_1_8 is
  'Current F1–F3 normal; used for listed student ids and all students from global_price_switch_date.';
