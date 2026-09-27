-- Per-student Student Progress cell selections.
-- Apply in Supabase SQL Editor if not migrated yet.

create table if not exists public.student_progress_selections (
  student_id text not null primary key references public.students(id) on delete cascade,
  selections jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

create index if not exists idx_student_progress_selections_updated
  on public.student_progress_selections (updated_at desc);

alter table public.student_progress_selections enable row level security;

drop policy if exists "allow all student_progress_selections" on public.student_progress_selections;
create policy "allow all student_progress_selections"
  on public.student_progress_selections
  for all
  using (true)
  with check (true);
