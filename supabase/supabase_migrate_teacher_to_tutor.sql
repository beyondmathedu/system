-- 在 Supabase：SQL Editor 整段执行一次即可。
-- 用途：网页已改用 public.tutors / public.tutor_rates，若数据库仍是 teachers / teacher_rates 会找不到表。

-- 1) 表：teachers -> tutors（仅当 tutors 尚不存在且 teachers 存在）
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

-- 2) 表：teacher_rates -> tutor_rates
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

-- 3) 欄位：teacher_id / teacher_name -> tutor_id / tutor_name（若仍是舊名）
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

-- 4) 若完全沒有舊表：補建 tutors / tutor_rates（與專案 supabase/supabase_student_lessons_schema.sql 一致）
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

alter table public.tutors drop constraint if exists teachers_status_check;
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

alter table public.tutors enable row level security;
alter table public.tutor_rates enable row level security;

drop policy if exists "allow all teachers" on public.tutors;
drop policy if exists "allow all tutors" on public.tutors;
create policy "allow all tutors" on public.tutors for all using (true) with check (true);

drop policy if exists "allow all teacher_rates" on public.tutor_rates;
drop policy if exists "allow all tutor_rates" on public.tutor_rates;
create policy "allow all tutor_rates" on public.tutor_rates for all using (true) with check (true);
