-- Reset tutor master list to the user-requested set, then seed tutor rates.
-- NOTE: This is destructive for existing tutor master/rate data.

begin;

-- 1) Remove existing rates first (avoid FK conflicts), then tutors.
delete from public.tutor_rates
where tutor_id in (select id from public.tutors);

delete from public.tutors;

-- 2) Seed requested tutors with sequential IDs from T001.
with tutor_input (
  seq,
  id,
  nickname,
  name_zh,
  name_en,
  birth_date,
  junior_rate,
  senior_rate,
  single_student_rate,
  mpf_enabled,
  status_zh,
  rate_effective_date
) as (
  values
    (1,  'T001', 'Alex',    '袁志軒', 'Yuen Chi Hin',    '2026-04-21'::date, 30,  60, 150, false, '工作中', '2026-04-21'::date),
    (2,  'T002', 'Howard',  'Howard', 'Howard',         null::date,         60,  90, 180, false, '工作中', current_date),
    (3,  'T003', 'Matthew', '蘇文傑', 'So Man Kit',      null::date,         60,  90, 180, true,  '工作中', current_date),
    (4,  'T004', 'Pammi',   '羅栩澄', 'Law Hui Ching',   null::date,         60,  90, 180, true,  '工作中', current_date),
    (5,  'T005', 'Rain',    'Rain',   'Rain',           null::date,         60,  90, 180, false, '工作中', current_date),
    (6,  'T006', 'Frank',   '李洛鋒', 'Li Lok Fung',     null::date,         60,  90, 180, true,  '工作中', current_date),
    (7,  'T007', 'Samuel',  '談俊濂', 'Tam Chun Lim',    null::date,         60, 100, 180, true,  '工作中', current_date),
    (8,  'T008', 'Candy',   '林媼珊', 'Lam Wan Shan',    null::date,          0,   0,   0, false, '工作中', current_date),
    (9,  'T009', 'Leo',     '張皓程', 'Cheung Ho Ching', null::date,         60,  90, 180, true,  '工作中', current_date),
    (10, 'T010', 'Kelly',   '張崇欣', 'Cheung Sung Yan', null::date,         30,  60, 150, false, '工作中', current_date),
    (11, 'T011', 'Li',      'Li',     'Li',             null::date,          0,   0,   0, true,  '放假中', current_date),
    (12, 'T012', 'Candy',   'Candy',  'Candy',          null::date,         60,  90, 180, true,  '放假中', current_date)
),
inserted_tutors as (
  insert into public.tutors (
    id,
    name,
    name_zh,
    name_en,
    birth_date,
    status,
    color_hex,
    mpf_enabled
  )
  select
    i.id,
    i.nickname,
    i.name_zh,
    i.name_en,
    i.birth_date,
    i.status_zh,
    '#1d76c2',
    i.mpf_enabled
  from tutor_input i
  order by i.seq
  returning id, name
)
insert into public.tutor_rates (
  tutor_id,
  tutor_name,
  junior_rate,
  senior_rate,
  single_student_rate,
  effective_date
)
select
  i.id,
  i.nickname,
  i.junior_rate,
  i.senior_rate,
  i.single_student_rate,
  i.rate_effective_date
from tutor_input i
join inserted_tutors t
  on t.id = i.id
order by i.seq;

commit;
