-- One permanent admin remark per student (Daily / Regular timetable; all dates).

alter table public.students
  add column if not exists timetable_permanent_remark text not null default '';

comment on column public.students.timetable_permanent_remark is
  'Admin-only note shown on every Daily/Regular timetable day for this student.';
