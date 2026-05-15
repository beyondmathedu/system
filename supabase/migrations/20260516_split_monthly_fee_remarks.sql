-- Split Makeup / Balance Due remarks from the main monthly Remarks column.

alter table public.student_monthly_fee_records
  add column if not exists makeup_remarks text not null default '';

alter table public.student_monthly_fee_records
  add column if not exists balance_due_remarks text not null default '';
