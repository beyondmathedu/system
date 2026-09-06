-- Student grade history by Academic Year (Sept 1 → next Aug 31).
-- academic_year e.g. '2026-27'.
--
-- Apply order (Supabase SQL Editor):
--   1) supabase_student_held_back_years.sql
--   2) supabase_student_grade_history.sql  (this file)
--   3) supabase_grade_promotion_write_history.sql
--   4) supabase_migrate_held_back_to_grade_history.sql  (preview first)
-- Optional one-time seed: seed_held_back_2026_elvin_ashley.sql (after step 1)

create table if not exists public.student_grade_history (
  student_id text not null references public.students(id) on delete cascade,
  academic_year text not null
    check (academic_year ~ '^\d{4}-\d{2}$'),
  grade text not null,
  status text not null default 'normal'
    check (status in ('normal', 'repeating', 'promoted', 'manual_adjustment')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, academic_year)
);

create index if not exists idx_student_grade_history_year
  on public.student_grade_history (academic_year);

alter table public.student_grade_history enable row level security;

drop policy if exists "allow all student_grade_history" on public.student_grade_history;
create policy "allow all student_grade_history"
  on public.student_grade_history
  for all
  using (true)
  with check (true);
