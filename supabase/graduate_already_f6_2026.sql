-- One-time 2026 recovery (already applied in production on 2026-09-01).
-- After the 1 Sept promotion, F.6 = last year's F.6 (74) + ex-F.5 (114).
-- Those 74 were identified as rows NOT updated in the promotion transaction
-- (xmin cluster 23751 = the 114 newly promoted F.6).
-- 8 of the 74 already had an open-ended inactive period; 66 received:
--   start 2026-07-01, end null, note 'auto: F6 graduated 2026 (pre-Sept cohort)'.
--
-- Future years: run 20260901_grade_promotion_graduate_existing_f6.sql so
-- run_student_grade_promotion() graduates already-F.6 before promoting F.5.

select 1;
