-- Daily / Regular timetable: cell colours & fee stripe thresholds (editable on site)
create table if not exists public.app_day_timetable_settings (
  id smallint primary key default 1 check (id = 1),
  reschedule_cell_bg_hex text not null default '#ede9fe',
  extra_cell_bg_hex text not null default '#fef3c7',
  fee_unpaid_stripe_hex text not null default '#f59e0b',
  fee_arrears_stripe_hex text not null default '#e11d48',
  fee_lookback_months smallint not null default 6,
  fee_heavy_unpaid_threshold smallint not null default 3,
  updated_at timestamptz not null default now(),
  constraint fee_lookback_months_chk check (fee_lookback_months >= 2 and fee_lookback_months <= 24),
  constraint fee_heavy_threshold_chk check (
    fee_heavy_unpaid_threshold >= 1
    and fee_heavy_unpaid_threshold <= 24
  )
);

insert into public.app_day_timetable_settings (id) values (1) on conflict (id) do nothing;

alter table public.app_day_timetable_settings enable row level security;

drop policy if exists "allow all app_day_timetable_settings" on public.app_day_timetable_settings;

create policy "allow all app_day_timetable_settings" on public.app_day_timetable_settings for all using (true) with check (true);
