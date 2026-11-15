-- Remove pair-discount / balance-adjustment feature (UI and app code already gone).
-- Keep 20260906_student_fee_balance_adjustments.sql as historical create migration.

drop policy if exists "allow all student_fee_balance_adjustments" on public.student_fee_balance_adjustments;
drop table if exists public.student_fee_balance_adjustments;
