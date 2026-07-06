-- Default tutor per room + weekday + time (versioned by effective_date).
create table if not exists public.room_slot_tutor_rules (
  id uuid primary key default gen_random_uuid(),
  room text not null,
  weekday text not null,
  time text not null,
  tutor_name text not null,
  effective_date date not null,
  created_at timestamptz not null default now(),
  constraint room_slot_tutor_rules_slot_effective_unique
    unique (room, weekday, time, effective_date)
);

create index if not exists idx_room_slot_tutor_rules_slot
  on public.room_slot_tutor_rules (room, weekday, time, effective_date desc);

alter table public.room_slot_tutor_rules enable row level security;

drop policy if exists "allow all room_slot_tutor_rules" on public.room_slot_tutor_rules;
create policy "allow all room_slot_tutor_rules" on public.room_slot_tutor_rules
  for all using (true) with check (true);
