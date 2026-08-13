-- Link Supabase Auth user → student portal (read-only own lessons).
-- 1) Auth user must exist (Supabase → Authentication → Users).
-- 2) students.id must exist.

-- Example: eddiechanwk2016@gmail.com → 00145 陳幸言
-- Auth user id from dashboard: e0b9fbf7-77fa-4b4e-9a70-5880289e91c8

insert into public.user_profiles (user_id, role, student_id, updated_at)
values (
  'e0b9fbf7-77fa-4b4e-9a70-5880289e91c8',
  'student',
  '00145',
  now()
)
on conflict (user_id) do update
set
  role = excluded.role,
  student_id = excluded.student_id,
  updated_at = now();
