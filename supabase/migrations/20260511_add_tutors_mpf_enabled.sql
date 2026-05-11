-- Add MPF toggle field for tutor records.
alter table public.tutors
add column if not exists mpf_enabled boolean not null default false;
