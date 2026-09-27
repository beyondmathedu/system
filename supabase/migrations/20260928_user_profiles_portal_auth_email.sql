-- Portal list perf: store Auth email on user_profiles so Students page avoids N× getUserById.

alter table public.user_profiles
  add column if not exists portal_auth_email text,
  add column if not exists portal_student_id_login_only boolean not null default false;

comment on column public.user_profiles.portal_auth_email is
  'Cached login email from auth.users; updated on provision / sync-email.';
comment on column public.user_profiles.portal_student_id_login_only is
  'True when Auth email is synthetic {studentId}@id.beyondmath.student (shared contact email).';

-- Backfill existing student portal links from auth.users.
update public.user_profiles up
set
  portal_auth_email = lower(au.email),
  portal_student_id_login_only = lower(au.email) ~ '^[0-9]+@id\.beyondmath\.student$'
from auth.users au
where up.user_id = au.id
  and up.role = 'student'
  and up.portal_auth_email is null;

create index if not exists idx_user_profiles_student_id
  on public.user_profiles (student_id)
  where student_id is not null;
