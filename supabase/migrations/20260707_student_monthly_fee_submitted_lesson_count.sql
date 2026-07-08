-- Zoho sync: store receipt line quantity for Tuition Paid hint, e.g. $820(4堂).

alter table public.student_monthly_fee_records
  add column if not exists submitted_lesson_count numeric(10,2);

comment on column public.student_monthly_fee_records.submitted_lesson_count is
  'Optional paid lesson count from Zoho receipt quantity; shown in Tuition Paid as $amount(N堂).';
