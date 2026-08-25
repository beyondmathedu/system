-- Remove unused Send Fee column from monthly fee records.
alter table public.student_monthly_fee_records
  drop column if exists send_fee;
