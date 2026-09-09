-- Per-student held-back (留班) years.
-- promotion_year = calendar year of the Sept 1 that does NOT promote
-- e.g. 2026 → skip 2026-09-01; student stays same form for 2026/9–2027/8.
-- Idempotent: safe to re-run in Supabase SQL Editor.

create table if not exists public.student_held_back_years (
  student_id text not null references public.students(id) on delete cascade,
  promotion_year integer not null check (promotion_year >= 2000 and promotion_year <= 2100),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id, promotion_year)
);

-- Migrate older local drafts that used academic_year (if any).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'student_held_back_years'
      and column_name = 'academic_year'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'student_held_back_years'
      and column_name = 'promotion_year'
  ) then
    alter table public.student_held_back_years rename column academic_year to promotion_year;
  end if;
end $$;

create index if not exists idx_student_held_back_years_year
  on public.student_held_back_years (promotion_year);

alter table public.student_held_back_years enable row level security;

drop policy if exists "allow all student_held_back_years" on public.student_held_back_years;
create policy "allow all student_held_back_years"
  on public.student_held_back_years
  for all
  using (true)
  with check (true);
