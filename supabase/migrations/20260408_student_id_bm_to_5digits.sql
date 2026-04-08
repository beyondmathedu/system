-- Convert students.id from "BM147" -> "00147" and cascade to all FKs.
-- Run this in Supabase SQL Editor (recommended: in a maintenance window).
--
-- Safety:
-- - Adds ON UPDATE CASCADE to all FK constraints referencing public.students(id)
-- - Validates that the new IDs would be unique
-- - Updates only ids starting with 'BM' followed by digits

begin;

-- 1) Ensure all FKs referencing students(id) have ON UPDATE CASCADE
do $$
declare
  r record;
  col_list text;
begin
  for r in
    select
      n.nspname as schema_name,
      c.relname as table_name,
      con.conname as constraint_name,
      con.conrelid as conrelid,
      con.conkey as conkey
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'public.students'::regclass
  loop
    select string_agg(format('%I', a.attname), ', ')
      into col_list
    from unnest(r.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a
      on a.attrelid = r.conrelid and a.attnum = k.attnum;

    if col_list is null then
      continue;
    end if;

    execute format('alter table %I.%I drop constraint %I', r.schema_name, r.table_name, r.constraint_name);
    execute format(
      'alter table %I.%I add constraint %I foreign key (%s) references public.students(id) on update cascade on delete cascade',
      r.schema_name,
      r.table_name,
      r.constraint_name,
      col_list
    );
  end loop;
end $$;

-- 2) Build mapping and verify uniqueness
create temp table _student_id_map on commit drop as
select
  id as old_id,
  lpad(regexp_replace(id, '^BM', ''), 5, '0') as new_id
from public.students
where id ~ '^BM[0-9]+$';

do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count
  from (
    select new_id
    from _student_id_map
    group by new_id
    having count(*) > 1
  ) t;
  if dup_count > 0 then
    raise exception 'Student ID migration aborted: duplicate new_id would be created.';
  end if;
end $$;

-- 3) Update students.id (FKs cascade)
update public.students s
set id = m.new_id
from _student_id_map m
where s.id = m.old_id;

commit;

