import { getLessonUntickedMetrics, type Lesson2026Record, type Lesson2026State } from "@/lib/lesson2026Summary";
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
  yearState: {
    attendance: Record<string, boolean>;
    hiddenDates: Record<string, boolean>;
    overrides: Lesson2026State["overrides"];
    rescheduleEntries: Lesson2026State["rescheduleEntries"];
    extraEntries: Lesson2026State["extraEntries"];
  };
  inactivePeriods: InactivePeriodRow[];
  nowMs: number;
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

  const state: Lesson2026State = {
    attendance: input.yearState.attendance ?? {},
    hiddenDates: input.yearState.hiddenDates ?? {},
    overrides: input.yearState.overrides ?? {},
    rescheduleEntries: input.yearState.rescheduleEntries ?? [],
    extraEntries: input.yearState.extraEntries ?? [],
  };

  const metrics = getLessonUntickedMetrics(
    input.scheduleRecords as Lesson2026Record[],
    state,
    input.nowMs,
    input.hubYear,
    { isDateInactive },
  );

  return {
    makeupCount: metrics.makeupCount,
    currentMonthUntickedCount: metrics.currentMonthUntickedCount,
  };
}
