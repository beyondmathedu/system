-- 學費色帶預設：當月未繳且只得 1 個月未繳 → #e11d48；≥2 個月未繳 → #000000；門檻 2
update public.app_day_timetable_settings
set
  fee_unpaid_stripe_hex = '#e11d48',
  fee_arrears_stripe_hex = '#000000',
  fee_heavy_unpaid_threshold = 2,
  updated_at = now()
where id = 1;
