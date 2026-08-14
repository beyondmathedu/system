import { getLessonUntickedMetrics, type Lesson2026Record } from "@/lib/lesson2026Summary";
import { toYearLessonStateFromClient } from "@/lib/feeRecordLessonDates";
import type { StudentLesson2026State } from "@/lib/studentLessonStorage";
import { makeStudentInactiveDateCheckerFromPeriods } from "@/lib/studentVisibility";

export type StudentLessonHubMetrics = {
  makeupCount: number;
  currentMonthUntickedCount: number;
};

type InactivePeriodRow = {
  id?: number;
  student_id?: string;
  start_date?: string | null;
  end_date?: string | null;
  note?: string | null;
};

export function computeStudentLessonHubMetrics(input: {
  studentId: string;
  hubYear: number;
  grade?: string | null;
  scheduleRecords: unknown[];
  yearState: StudentLesson2026State;
  inactivePeriods: InactivePeriodRow[];
  nowMs?: number;
}): StudentLessonHubMetrics {
  const periods = (input.inactivePeriods ?? [])
    .map((p) => ({
      studentId: input.studentId,
      startDate: String(p.start_date ?? "").trim(),
      endDate: p.end_date ? String(p.end_date).trim() : null,
      note: String(p.note ?? ""),
    }))
    .filter((p) => p.startDate);

  const isDateInactive = makeStudentInactiveDateCheckerFromPeriods({
    studentId: input.studentId,
    grade: input.grade ?? "",
    year: input.hubYear,
    periods,
  });

  const state = toYearLessonStateFromClient(input.yearState);

  const metrics = getLessonUntickedMetrics(
    input.scheduleRecords as Lesson2026Record[],
    state,
    input.nowMs ?? Date.now(),
    input.hubYear,
    { isDateInactive },
  );

  return {
    makeupCount: metrics.makeupCount,
    currentMonthUntickedCount: metrics.currentMonthUntickedCount,
  };
}
