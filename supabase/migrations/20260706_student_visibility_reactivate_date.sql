-- Optional expected return date for inactive students (home page reminder).
alter table public.student_visibility_modes
  add column if not exists reactivate_date date;

comment on column public.student_visibility_modes.reactivate_date is
  'Optional YYYY-MM-DD when admin expects student to return Active; used for home reminders only.';
