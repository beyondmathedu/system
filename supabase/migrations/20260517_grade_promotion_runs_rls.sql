-- Supabase linter: enable RLS on grade promotion audit table(s).
-- Safe to re-run.

do $rls$
declare
  tbl text;
  tables text[] := array['grade_promotion_runs', 'student_grade_promotion_runs'];
begin
  foreach tbl in array tables
  loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = tbl
    ) then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('drop policy if exists "allow all %I" on public.%I', tbl, tbl);
      execute format(
        'create policy "allow all %I" on public.%I for all using (true) with check (true)',
        tbl,
        tbl
      );
    end if;
  end loop;
end
$rls$;
