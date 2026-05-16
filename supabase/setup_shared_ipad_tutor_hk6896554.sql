-- 共用 iPad 帳 hk6896554@gmail.com
-- 1) 在 Supabase Auth 建立此 email 用戶（若尚未存在）
-- 2) 將下方 YOUR_AUTH_USER_UUID 換成該用戶 uuid 後執行

-- 確保 tutors 表有 iPad Shared（非授課導師，僅供 profile 連結）
insert into public.tutors (id, name, name_zh, name_en, status, color_hex, mpf_enabled)
values ('T_IPAD', 'iPad Shared', 'iPad Shared', 'iPad Shared', '工作中', '#64748b', false)
on conflict (id) do update
set
  name = excluded.name,
  name_zh = excluded.name_zh,
  name_en = excluded.name_en,
  status = excluded.status;

-- 角色：tutor（應用程式會依 email 自動開放全部 5 個課室）
-- insert into public.user_profiles (user_id, role, tutor_id)
-- values ('YOUR_AUTH_USER_UUID', 'tutor', 'T_IPAD')
-- on conflict (user_id) do update
-- set role = excluded.role, tutor_id = excluded.tutor_id, updated_at = now();

-- 可選：資料庫層亦寫入五個課室（與應用程式 ALL_CLASSROOM_SLUGS 一致）
-- insert into public.tutor_room_permissions (tutor_id, room_slug) values
--   ('T_IPAD', 'b'),
--   ('T_IPAD', 'm-qian'),
--   ('T_IPAD', 'm-hou'),
--   ('T_IPAD', 'hope'),
--   ('T_IPAD', 'hope-2')
-- on conflict do nothing;
