-- Per-lesson tuition unit price for FIFO allocation of submitted_amount → L1..L9 slots on fee sheet.
alter table public.student_monthly_fee_records
  add column if not exists lesson_unit_price numeric(10, 2);

comment on column public.student_monthly_fee_records.lesson_unit_price is
  '每堂學費（HKD）；有值時以 FIFO 將本月「已繳」分配到 L1 起各堂，用於顯示欠第幾堂／半堂。';
