create table if not exists public.students (
  id text primary key,
  name_zh text not null,
  name_en text not null,
  nickname_en text not null,
  birth_date date not null,
  student_phone text not null,
  email text not null,
  school text not null,
  grade text not null,
  math_language text not null check (math_language in ('中文', '英文')),
  created_at timestamptz not null default now()
);

alter table public.students enable row level security;

drop policy if exists "Allow read students" on public.students;
drop policy if exists "Allow insert students" on public.students;
drop policy if exists "Allow update students" on public.students;
drop policy if exists "Allow delete students" on public.students;

create policy "Allow read students"
on public.students
for select
to anon, authenticated
using (true);

create policy "Allow insert students"
on public.students
for insert
to anon, authenticated
with check (true);

create policy "Allow update students"
on public.students
for update
to anon, authenticated
using (true)
with check (true);

create policy "Allow delete students"
on public.students
for delete
to anon, authenticated
using (true);
