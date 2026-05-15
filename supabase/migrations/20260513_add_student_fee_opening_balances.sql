-- Opening balance for legacy tuition (pre system start).
-- Used by /students-lesson-time-fee-record to lock historical balance.

create table if not exists public.student_fee_opening_balances (
  student_id text not null references public.students(id) on delete cascade,
  as_of_year integer not null,
  as_of_month integer not null check (as_of_month >= 1 and as_of_month <= 12),
  opening_balance numeric(10,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (student_id, as_of_year, as_of_month)
);

create index if not exists idx_student_fee_opening_balances_as_of
  on public.student_fee_opening_balances (as_of_year, as_of_month);

alter table public.student_fee_opening_balances enable row level security;

drop policy if exists "allow all student_fee_opening_balances" on public.student_fee_opening_balances;
create policy "allow all student_fee_opening_balances"
  on public.student_fee_opening_balances
  for all
  using (true)
  with check (true);

