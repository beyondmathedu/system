-- Patch: ensure check constraints allow `needs_review`.
-- This fixes errors like:
--   new row violates check constraint "questions_difficulty_check"
-- when `difficulty` / `ai_difficulty` constraints were created from an older schema.

do $$
begin
  -- difficulty
  if exists (
    select 1 from pg_constraint
    where conname = 'questions_difficulty_check'
      and conrelid = 'public.questions'::regclass
  ) then
    execute 'alter table public.questions drop constraint questions_difficulty_check';
  end if;

  -- ai_difficulty
  if exists (
    select 1 from pg_constraint
    where conname = 'questions_ai_difficulty_check'
      and conrelid = 'public.questions'::regclass
  ) then
    execute 'alter table public.questions drop constraint questions_ai_difficulty_check';
  end if;
exception
  when undefined_object then null;
end $$;

alter table public.questions
  add constraint questions_difficulty_check
  check (difficulty is null or difficulty in ('L1', 'L2', 'L3', 'needs_review'));

alter table public.questions
  add constraint questions_ai_difficulty_check
  check (ai_difficulty is null or ai_difficulty in ('L1', 'L2', 'L3', 'needs_review'));

notify pgrst, 'reload schema';

