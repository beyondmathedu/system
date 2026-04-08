-- migration: teacher -> tutor（可重複執行；若已是 tutor_id／tutor_name 則略過）
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'teachers'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'tutors'
  ) then
    alter table public.teachers rename to tutors;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'teacher_rates'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'tutor_rates'
  ) then
    alter table public.teacher_rates rename to tutor_rates;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tutor_rates' and column_name = 'teacher_id'
  ) then
    alter table public.tutor_rates rename column teacher_id to tutor_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tutor_rates' and column_name = 'teacher_name'
  ) then
    alter table public.tutor_rates rename column teacher_name to tutor_name;
  end if;
end $$;

-- Run in Supabase SQL Editor
-- 注意：此檔案依賴 public.students（請先執行 supabase/supabase-students.sql 或確保 students 表已存在）

create table if not exists public.student_exam_dates (
  student_id text primary key references public.students(id) on delete cascade,
  exam_date text not null default '',
  updated_at timestamptz not null default now()
);

-- Daily / Regular timetable 當日 Remarks（學生 + 日期）
create table if not exists public.student_timetable_day_remarks (
  student_id text not null references public.students(id) on delete cascade,
  date_iso date not null,
  remarks text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id, date_iso)
);

create index if not exists idx_student_timetable_day_remarks_date
  on public.student_timetable_day_remarks (date_iso);

-- 學生顯示模式（Active/Inactive）與生效日：
-- 若 mode='inactive' 且 effective_date <= 查詢日期，則該生在課堂相關頁面隱藏
create table if not exists public.student_visibility_modes (
  student_id text primary key references public.students(id) on delete cascade,
  mode text not null default 'active' check (mode in ('active', 'inactive')),
  effective_date date not null default current_date,
  updated_at timestamptz not null default now()
);

-- /students-lesson-time-fee-record：每月手填欄位（已交/Remarks/月尾Send學費）
create table if not exists public.student_monthly_fee_records (
  student_id text not null references public.students(id) on delete cascade,
  year integer not null,
  month integer not null check (month >= 1 and month <= 12),
  submitted_amount numeric(10,2) not null default 0 check (submitted_amount >= 0),
  remarks text not null default '',
  send_fee boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (student_id, year, month)
);

create index if not exists idx_student_monthly_fee_records_year_month
  on public.student_monthly_fee_records (year, month);

-- Tutor Monthly：多人同一時段「第一席位」金額（全站一筆；網頁 /tutor-monthly-lesson-record 可編輯）
create table if not exists public.app_payroll_settings (
  id smallint primary key default 1 check (id = 1),
  multi_student_first_amount numeric(10, 2) not null default 120 check (multi_student_first_amount >= 0),
  updated_at timestamptz not null default now()
);

insert into public.app_payroll_settings (id, multi_student_first_amount)
values (1, 120)
on conflict (id) do nothing;

create table if not exists public.student_lesson_records (
  student_id text primary key references public.students(id) on delete cascade,
  records jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.student_lessons_2026_state (
  student_id text primary key references public.students(id) on delete cascade,
  attendance jsonb not null default '{}'::jsonb,
  hidden_dates jsonb not null default '{}'::jsonb,
  overrides jsonb not null default '{}'::jsonb,
  reschedule_entries jsonb not null default '[]'::jsonb,
  extra_entries jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.student_lessons_2026_metrics (
  student_id text primary key references public.students(id) on delete cascade,
  remedial_count integer not null default 0,
  current_month_absent_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.student_lessons_year_state (
  student_id text not null references public.students(id) on delete cascade,
  year integer not null,
  attendance jsonb not null default '{}'::jsonb,
  hidden_dates jsonb not null default '{}'::jsonb,
  overrides jsonb not null default '{}'::jsonb,
  reschedule_entries jsonb not null default '[]'::jsonb,
  extra_entries jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (student_id, year)
);

create table if not exists public.tutors (
  id text primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

alter table public.tutors add column if not exists name_zh text not null default '';
alter table public.tutors add column if not exists name_en text not null default '';
alter table public.tutors add column if not exists nickname_en text not null default '';
alter table public.tutors add column if not exists status text not null default '工作中';
alter table public.tutors add column if not exists color_hex text not null default '';
alter table public.tutors drop constraint if exists tutors_status_check;
alter table public.tutors
  add constraint tutors_status_check check (status in ('工作中', '放假中', '已解僱'));

create table if not exists public.tutor_rates (
  id bigserial primary key,
  tutor_id text not null references public.tutors(id) on delete cascade,
  tutor_name text not null,
  junior_rate numeric(10,2) not null default 0 check (junior_rate >= 0),
  senior_rate numeric(10,2) not null default 0 check (senior_rate >= 0),
  single_student_rate numeric(10,2) not null default 0 check (single_student_rate >= 0),
  effective_date date not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_tutor_rates_tutor_id on public.tutor_rates(tutor_id);
create index if not exists idx_tutor_rates_effective_date on public.tutor_rates(effective_date desc);
create index if not exists idx_tutor_rates_tutor_effective_desc
  on public.tutor_rates(tutor_id, effective_date desc, id desc);

create or replace view public.latest_tutor_rates as
select distinct on (tr.tutor_id)
  tr.tutor_id,
  tr.tutor_name,
  tr.junior_rate,
  tr.senior_rate,
  tr.single_student_rate,
  tr.effective_date,
  tr.updated_at
from public.tutor_rates tr
order by tr.tutor_id, tr.effective_date desc, tr.id desc;

alter table public.student_exam_dates enable row level security;
alter table public.student_timetable_day_remarks enable row level security;
alter table public.student_visibility_modes enable row level security;
alter table public.student_monthly_fee_records enable row level security;
alter table public.student_lesson_records enable row level security;
alter table public.student_lessons_2026_state enable row level security;
alter table public.student_lessons_2026_metrics enable row level security;
alter table public.student_lessons_year_state enable row level security;
alter table public.tutors enable row level security;
alter table public.tutor_rates enable row level security;

-- For internal/admin usage. Replace with stricter policies if needed.
drop policy if exists "allow all student_exam_dates" on public.student_exam_dates;
create policy "allow all student_exam_dates" on public.student_exam_dates for all using (true) with check (true);

drop policy if exists "allow all student_timetable_day_remarks" on public.student_timetable_day_remarks;
create policy "allow all student_timetable_day_remarks"
  on public.student_timetable_day_remarks for all using (true) with check (true);

drop policy if exists "allow all student_visibility_modes" on public.student_visibility_modes;
create policy "allow all student_visibility_modes" on public.student_visibility_modes for all using (true) with check (true);

drop policy if exists "allow all student_monthly_fee_records" on public.student_monthly_fee_records;
create policy "allow all student_monthly_fee_records" on public.student_monthly_fee_records for all using (true) with check (true);

alter table public.app_payroll_settings enable row level security;

drop policy if exists "allow all app_payroll_settings" on public.app_payroll_settings;
create policy "allow all app_payroll_settings"
  on public.app_payroll_settings for all using (true) with check (true);

drop policy if exists "allow all student_lesson_records" on public.student_lesson_records;
create policy "allow all student_lesson_records" on public.student_lesson_records for all using (true) with check (true);

drop policy if exists "allow all student_lessons_2026_state" on public.student_lessons_2026_state;
create policy "allow all student_lessons_2026_state" on public.student_lessons_2026_state for all using (true) with check (true);

drop policy if exists "allow all student_lessons_2026_metrics" on public.student_lessons_2026_metrics;
create policy "allow all student_lessons_2026_metrics" on public.student_lessons_2026_metrics for all using (true) with check (true);

drop policy if exists "allow all student_lessons_year_state" on public.student_lessons_year_state;
create policy "allow all student_lessons_year_state" on public.student_lessons_year_state for all using (true) with check (true);

drop policy if exists "allow all tutors" on public.tutors;
create policy "allow all tutors" on public.tutors for all using (true) with check (true);

drop policy if exists "allow all tutor_rates" on public.tutor_rates;
create policy "allow all tutor_rates" on public.tutor_rates for all using (true) with check (true);

-- 教室／房間（導航與 /rooms/[slug] 對應；name 須與學生課表 JSON 內 room 欄位一致）
create table if not exists public.classrooms (
  id text primary key,
  name text not null,
  slug text not null unique,
  description text not null default '',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_classrooms_slug on public.classrooms (slug);

insert into public.classrooms (id, name, slug, description, sort_order)
values
  ('R001', 'B', 'b', 'Room B 排課與使用資訊', 1),
  ('R002', 'M前', 'm-qian', 'M 前座 Room 資訊', 2),
  ('R003', 'M後', 'm-hou', 'M 後座 Room 資訊', 3),
  ('R004', 'Hope', 'hope', 'Hope Room 資訊', 4),
  ('R005', 'Hope 2', 'hope-2', 'Hope 2 Room 資訊', 5)
on conflict (id) do nothing;

alter table public.classrooms enable row level security;

drop policy if exists "allow all classrooms" on public.classrooms;
create policy "allow all classrooms" on public.classrooms for all using (true) with check (true);
