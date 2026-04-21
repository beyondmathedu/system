-- Add date of birth field for tutors.
alter table public.tutors
add column if not exists birth_date date;
