-- Merge per-date lesson overrides server-side (room-page tutor edits, etc.).

create or replace function public.patch_lesson_year_overrides(
  p_student_id text,
  p_year integer,
  p_patch jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  merged jsonb;
  dk text;
  patch_val jsonb;
begin
  if p_student_id is null or btrim(p_student_id) = '' then
    raise exception 'p_student_id is required';
  end if;
  if p_year is null then
    raise exception 'p_year is required';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a JSON object';
  end if;

  insert into public.student_lessons_year_state (
    student_id,
    year,
    overrides,
    updated_at
  )
  values (
    p_student_id,
    p_year,
    '{}'::jsonb,
    now()
  )
  on conflict (student_id, year) do nothing;

  select coalesce(overrides, '{}'::jsonb)
  into merged
  from public.student_lessons_year_state
  where student_id = p_student_id
    and year = p_year
  for update;

  for dk, patch_val in
    select key, value from jsonb_each(p_patch)
  loop
    merged := jsonb_set(
      merged,
      array[dk],
      coalesce(merged -> dk, '{}'::jsonb) || patch_val,
      true
    );
  end loop;

  update public.student_lessons_year_state
  set
    overrides = merged,
    updated_at = now()
  where student_id = p_student_id
    and year = p_year;
end;
$$;

grant execute on function public.patch_lesson_year_overrides(text, integer, jsonb)
  to anon, authenticated, service_role;
