-- Manual whitelist: which student ids use current (new) tiers before global switch.
alter table public.app_student_fee_tier_settings
  add column if not exists current_price_student_ids text not null default '';

comment on column public.app_student_fee_tier_settings.current_price_student_ids is
  'Newline/comma-separated student ids on current tiers before global_price_switch_date; unlisted students stay on legacy.';

comment on column public.app_student_fee_tier_settings.f_low_tier_1_8 is
  'Legacy F1–F3 normal (1..N lessons) for students not in current_price_student_ids until global switch.';
comment on column public.app_student_fee_tier_settings.current_f_low_tier_1_8 is
  'Current F1–F3 normal; used for listed student ids and all students from global_price_switch_date.';
