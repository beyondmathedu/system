-- Allow creating students without birth date.
alter table public.students
  alter column birth_date drop not null;

