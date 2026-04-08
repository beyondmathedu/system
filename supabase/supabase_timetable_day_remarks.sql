-- Daily / Regular timetable「Remarks」欄：依學生 + 日期儲存（與課表 Lesson Summary 分開）。
-- 在 Supabase SQL Editor 執行一次即可。

create table if not exists public.student_timetable_day_remarks (
  student_id text not null references public.students(id) on delete cascade,
  date_iso date not null,
  remarks text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id, date_iso)
);

create index if not exists idx_student_timetable_day_remarks_date
  on public.student_timetable_day_remarks (date_iso);

alter table public.student_timetable_day_remarks enable row level security;

drop policy if exists "allow all student_timetable_day_remarks" on public.student_timetable_day_remarks;
create policy "allow all student_timetable_day_remarks"
  on public.student_timetable_day_remarks for all using (true) with check (true);
