-- P2: merge attendance keys server-side (small RPC payload for room-page ticks).

create or replace function public.patch_lesson_year_attendance(
  p_student_id text,
  p_year integer,
  p_patch jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
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
    attendance,
    updated_at
  )
  values (
    p_student_id,
    p_year,
    p_patch,
    now()
  )
  on conflict (student_id, year) do update
  set
    attendance = coalesce(public.student_lessons_year_state.attendance, '{}'::jsonb) || excluded.attendance,
    updated_at = now();
end;
$$;

grant execute on function public.patch_lesson_year_attendance(text, integer, jsonb)
  to anon, authenticated, service_role;
