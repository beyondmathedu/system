create table if not exists public.app_progress_mock_sets (
  id smallint primary key default 1 check (id = 1),
  labels jsonb not null default '[]'::jsonb,
  years jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_progress_mock_sets
  add column if not exists years jsonb not null default '[]'::jsonb;

insert into public.app_progress_mock_sets (id)
values (1)
on conflict (id) do nothing;

alter table public.app_progress_mock_sets enable row level security;

drop policy if exists "allow all app_progress_mock_sets" on public.app_progress_mock_sets;
create policy "allow all app_progress_mock_sets"
  on public.app_progress_mock_sets
  for all
  using (true)
  with check (true);
