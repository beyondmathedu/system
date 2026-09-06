-- Per-student tuition balance adjustments (e.g. 開學優惠).
-- Signed amount: negative = discount/credit; positive = extra charge.
-- Idempotent: safe to re-run in Supabase SQL Editor.

create table if not exists public.student_fee_balance_adjustments (
  student_id text not null references public.students(id) on delete cascade,
  amount numeric(10,2) not null default 0,
  reason text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id)
);

alter table public.student_fee_balance_adjustments enable row level security;

drop policy if exists "allow all student_fee_balance_adjustments" on public.student_fee_balance_adjustments;
create policy "allow all student_fee_balance_adjustments"
  on public.student_fee_balance_adjustments
  for all
  using (true)
  with check (true);
