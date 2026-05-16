-- 課室課表：多裝置／多帳號即時同步出席與 Lesson summary
-- 在 Supabase Dashboard → Database → Replication 確認已啟用亦可

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'student_lessons_year_state'
  ) then
    alter publication supabase_realtime add table public.student_lessons_year_state;
  end if;
end $$;

alter table public.student_lessons_year_state replica identity full;
