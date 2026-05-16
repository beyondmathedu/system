-- 登入角色 + 導師可查看的房間（對應 /rooms/[slug]）
-- 在 Supabase SQL Editor 執行一次。

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'tutor', 'student')),
  tutor_id text references public.tutors (id) on delete set null,
  student_id text references public.students (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_profiles_role on public.user_profiles (role);
create index if not exists idx_user_profiles_tutor_id on public.user_profiles (tutor_id);

create table if not exists public.tutor_room_permissions (
  tutor_id text not null references public.tutors (id) on delete cascade,
  room_slug text not null,
  primary key (tutor_id, room_slug)
);

create index if not exists idx_tutor_room_permissions_slug on public.tutor_room_permissions (room_slug);

alter table public.user_profiles enable row level security;
alter table public.tutor_room_permissions enable row level security;

drop policy if exists "user_profiles read own" on public.user_profiles;
create policy "user_profiles read own" on public.user_profiles
  for select using (auth.uid() = user_id);

drop policy if exists "tutor_room_permissions read own tutor" on public.tutor_room_permissions;
create policy "tutor_room_permissions read own tutor" on public.tutor_room_permissions
  for select using (
    exists (
      select 1
      from public.user_profiles up
      where up.user_id = auth.uid()
        and up.role = 'tutor'
        and up.tutor_id = tutor_room_permissions.tutor_id
    )
  );

-- 內部管理：service role / 現有寬鬆 policy 若已有可保留；以下供 anon 登入用戶讀自己 profile
-- Admin 寫入請用 Supabase Dashboard Table Editor 或 service role。

comment on table public.user_profiles is 'Auth 用戶角色：admin / tutor / student';
comment on table public.tutor_room_permissions is '導師可開的房間 slug，須與 classrooms.slug 一致';

-- ========== 建立「只看房間課表」帳號範例 ==========
-- 1) Supabase Auth → Users → Add user（email + 密碼）
-- 2) 將下面 YOUR_AUTH_USER_UUID、TUTOR_ID 換成真實值後執行：

-- insert into public.user_profiles (user_id, role, tutor_id)
-- values ('YOUR_AUTH_USER_UUID', 'tutor', 'T001')
-- on conflict (user_id) do update set role = excluded.role, tutor_id = excluded.tutor_id;

-- 五個教室全部可見（與導航 Rooms 下拉一致）：
-- insert into public.tutor_room_permissions (tutor_id, room_slug) values
--   ('T001', 'b'),
--   ('T001', 'm-qian'),
--   ('T001', 'm-hou'),
--   ('T001', 'hope'),
--   ('T001', 'hope-2')
-- on conflict do nothing;

-- 若只允許部分房間，只 insert 需要的 slug 即可。
