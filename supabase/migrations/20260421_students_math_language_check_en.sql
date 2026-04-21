-- Align students.math_language check constraint with canonical values.
alter table public.students
drop constraint if exists students_math_language_check;

alter table public.students
add constraint students_math_language_check
check (math_language is null or btrim(math_language) in ('Chinese', 'English'));
