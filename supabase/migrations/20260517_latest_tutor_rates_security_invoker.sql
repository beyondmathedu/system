-- Supabase linter: latest_tutor_rates should use invoker RLS, not SECURITY DEFINER.
-- Requires PostgreSQL 15+ (Supabase default).

drop view if exists public.latest_tutor_rates;

create view public.latest_tutor_rates
with (security_invoker = true)
as
select distinct on (tr.tutor_id)
  tr.tutor_id,
  tr.tutor_name,
  tr.junior_rate,
  tr.senior_rate,
  tr.single_student_rate,
  tr.effective_date,
  tr.updated_at
from public.tutor_rates tr
order by tr.tutor_id, tr.effective_date desc, tr.id desc;

grant select on public.latest_tutor_rates to anon, authenticated, service_role;
