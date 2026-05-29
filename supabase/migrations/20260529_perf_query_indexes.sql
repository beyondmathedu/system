-- Speed up timetable / fee pages that filter by year or student_id lists.

CREATE INDEX IF NOT EXISTS idx_student_lessons_year_state_year
  ON public.student_lessons_year_state (year);

CREATE INDEX IF NOT EXISTS idx_student_visibility_modes_student_id
  ON public.student_visibility_modes (student_id);

CREATE INDEX IF NOT EXISTS idx_student_monthly_fee_records_year_month
  ON public.student_monthly_fee_records (year, month);
