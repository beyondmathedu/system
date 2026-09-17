-- Manual 0·Single guarantee rows for Tutor Monthly Payroll (date + time + tutor; no room/student).
create table if not exists public.tutor_manual_guarantees (
  id uuid primary key default gen_random_uuid(),
  tutor_id text not null references public.tutors (id) on delete cascade,
  lesson_date date not null,
  lesson_time text not null,
  time_key text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint tutor_manual_guarantees_tutor_date_time_unique
    unique (tutor_id, lesson_date, time_key)
);

create index if not exists idx_tutor_manual_guarantees_tutor_date
  on public.tutor_manual_guarantees (tutor_id, lesson_date);

comment on table public.tutor_manual_guarantees is
  'Admin-added Tutor Monthly 0·Single guarantees (manual guarantee); unique per tutor + date + time.';

alter table public.tutor_manual_guarantees enable row level security;

drop policy if exists "allow all tutor_manual_guarantees" on public.tutor_manual_guarantees;
create policy "allow all tutor_manual_guarantees" on public.tutor_manual_guarantees
  for all using (true) with check (true);
