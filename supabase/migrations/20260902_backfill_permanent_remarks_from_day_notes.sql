-- One-time: copy existing day remarks into students.timetable_permanent_remark.
-- Run AFTER 20260902_student_timetable_permanent_remark.sql.
--
-- Per student: picks the non-empty remark used on the most days; tie-break = latest date.
-- Does not delete day remarks (Today only notes stay as-is).

with remark_stats as (
  select
    student_id,
    trim(remarks) as remarks,
    count(*)::int as day_count,
    max(date_iso) as latest_date
  from public.student_timetable_day_remarks
  where trim(coalesce(remarks, '')) <> ''
  group by student_id, trim(remarks)
),
best_per_student as (
  select distinct on (student_id)
    student_id,
    remarks,
    day_count,
    latest_date
  from remark_stats
  order by student_id, day_count desc, latest_date desc
)
update public.students s
set timetable_permanent_remark = b.remarks
from best_per_student b
where s.id = b.student_id
  and trim(coalesce(s.timetable_permanent_remark, '')) = '';

-- Optional: see what was copied
-- select s.id, s.name_zh, s.timetable_permanent_remark, b.day_count, b.latest_date
-- from public.students s
-- join best_per_student b on b.student_id = s.id
-- where trim(s.timetable_permanent_remark) <> ''
-- order by s.id;
