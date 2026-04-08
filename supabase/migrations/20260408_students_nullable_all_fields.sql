-- Allow empty form fields to be stored as NULL in students table.
-- Keep id as primary key (required), make other columns nullable.
alter table public.students alter column name_zh drop not null;
alter table public.students alter column name_en drop not null;
alter table public.students alter column nickname_en drop not null;
alter table public.students alter column birth_date drop not null;
alter table public.students alter column student_phone drop not null;
alter table public.students alter column email drop not null;
alter table public.students alter column school drop not null;
alter table public.students alter column grade drop not null;
alter table public.students alter column math_language drop not null;

