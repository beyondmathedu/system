-- Add configurable MPF relevant-income threshold for Tutor Monthly Record.
-- Run in Supabase SQL Editor after app_payroll_settings exists.

alter table public.app_payroll_settings
  add column if not exists mpf_relevant_income_threshold numeric(10, 2) not null default 7100
  check (mpf_relevant_income_threshold >= 0);

comment on column public.app_payroll_settings.mpf_relevant_income_threshold is
  'Tutor Monthly: show employer MPF lines when monthly salary is greater than or equal to this amount (HKD).';
