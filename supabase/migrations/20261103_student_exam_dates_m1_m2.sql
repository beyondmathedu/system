-- Separate upcoming exam date/content for Maths Extended M1 / M2.

alter table public.student_exam_dates
  add column if not exists m1_exam_date text not null default '',
  add column if not exists m1_exam_content text not null default '',
  add column if not exists m2_exam_date text not null default '',
  add column if not exists m2_exam_content text not null default '';
