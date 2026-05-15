-- Seed 8 tutors from provided list.
-- Safe to re-run: rows with same (name_en, name_zh) are skipped.

with input_rows(ord, name_en, name_zh, nickname) as (
  values
    (1, 'Law Hui Ching', '羅栩澄', 'Pammi'),
    (2, 'So Man Kit', '蘇文傑', 'Matthew'),
    (3, 'Li Lok Fung', '李洛鋒', 'Frank'),
    (4, 'Tam Chun Lim', '談俊濂', 'Samuel'),
    (5, 'Lam Wan Shan', '林媼珊', 'Candy'),
    (6, 'Cheung Ho Ching', '張皓程', 'Leo'),
    (7, 'Cheung Sung Yan', '張崇欣', 'Kelly'),
    (8, 'Yuen Chi Hin', '袁志軒', 'Alex')
),
to_insert as (
  select i.*
  from input_rows i
  where not exists (
    select 1
    from public.tutors t
    where t.name_en = i.name_en
      and t.name_zh = i.name_zh
  )
),
base as (
  select coalesce(max(substring(id from 2)::int), 0) as max_n
  from public.tutors
  where id ~ '^T[0-9]+$'
),
numbered as (
  select
    t.ord,
    t.name_en,
    t.name_zh,
    t.nickname,
    row_number() over (order by t.ord) as rn
  from to_insert t
)
insert into public.tutors (
  id,
  name,
  name_zh,
  name_en,
  nickname_en,
  status,
  color_hex,
  mpf_enabled
)
select
  'T' || lpad((b.max_n + n.rn)::text, 3, '0') as id,
  n.nickname as name,
  n.name_zh,
  n.name_en,
  n.nickname as nickname_en,
  '工作中' as status,
  '#1d76c2' as color_hex,
  false as mpf_enabled
from numbered n
cross join base b
order by n.ord;
