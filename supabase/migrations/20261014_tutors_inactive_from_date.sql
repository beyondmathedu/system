-- Leave-start date for inactive tutors: lessons on/after this date show TBD;
-- lessons before keep the stored tutor name.

alter table public.tutors
  add column if not exists inactive_from_date date;

comment on column public.tutors.inactive_from_date is
  'When status is 已解僱: blank tutor name on lesson dates on/after this date (HK). Null = treat as leave after today (past/today keep name).';
