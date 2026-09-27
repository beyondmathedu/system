-- Whether the student takes M1 and/or M2 (both can be true).
alter table public.students
  add column if not exists takes_m1 boolean not null default false,
  add column if not exists takes_m2 boolean not null default false;
