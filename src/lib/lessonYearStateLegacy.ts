import { LESSON_SYSTEM_START_YEAR } from "@/lib/lessonSystemStart";
import {
  DEFAULT_LESSON_YEAR_STATE,
  parseLessonYearStateDbRow,
  type StudentLesson2026State,
} from "@/lib/lessonYearStateShared";

/** Year whose lesson state was originally stored in `student_lessons_2026_*` tables. */
export const LEGACY_LESSON_STATE_YEAR = LESSON_SYSTEM_START_YEAR;

export const LEGACY_2026_STATE_SELECT =
  "student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries" as const;

export function isEmptyLessonYearState(state: StudentLesson2026State | undefined | null): boolean {
  if (!state) return true;
  return (
    Object.keys(state.attendance).length === 0 &&
    Object.keys(state.hiddenDates).length === 0 &&
    Object.keys(state.overrides).length === 0 &&
    state.rescheduleEntries.length === 0 &&
    state.extraEntries.length === 0
  );
}

export function mergeYearStateWithLegacyFallback(
  yearState: StudentLesson2026State,
  legacyState: StudentLesson2026State | undefined,
  year: number,
): StudentLesson2026State {
  if (year !== LEGACY_LESSON_STATE_YEAR) return yearState;
  if (!legacyState || isEmptyLessonYearState(legacyState)) return yearState;
  if (isEmptyLessonYearState(yearState)) return legacyState;

  return {
    attendance: Object.keys(yearState.attendance).length
      ? yearState.attendance
      : legacyState.attendance,
    hiddenDates: Object.keys(yearState.hiddenDates).length
      ? yearState.hiddenDates
      : legacyState.hiddenDates,
    overrides: Object.keys(yearState.overrides).length
      ? yearState.overrides
      : legacyState.overrides,
    rescheduleEntries: yearState.rescheduleEntries.length
      ? yearState.rescheduleEntries
      : legacyState.rescheduleEntries,
    extraEntries: yearState.extraEntries.length
      ? yearState.extraEntries
      : legacyState.extraEntries,
  };
}

export function studentIdsNeedingLegacyStateFallback(
  studentIds: string[],
  yearStates: Record<string, StudentLesson2026State>,
  year: number,
): string[] {
  if (year !== LEGACY_LESSON_STATE_YEAR) return [];
  return studentIds.filter((id) => isEmptyLessonYearState(yearStates[id]));
}

export function mergeYearStatesBatchWithLegacyFallback(
  studentIds: string[],
  year: number,
  yearStates: Record<string, StudentLesson2026State>,
  legacyStates: Record<string, StudentLesson2026State>,
): Record<string, StudentLesson2026State> {
  const out: Record<string, StudentLesson2026State> = { ...yearStates };
  for (const id of studentIds) {
    out[id] = mergeYearStateWithLegacyFallback(
      out[id] ?? { ...DEFAULT_LESSON_YEAR_STATE },
      legacyStates[id],
      year,
    );
  }
  return out;
}

export function parseLegacy2026StateRows(
  rows: Array<Record<string, unknown>>,
): Record<string, StudentLesson2026State> {
  const out: Record<string, StudentLesson2026State> = {};
  for (const row of rows) {
    const sid = String(row.student_id ?? "");
    if (!sid) continue;
    out[sid] = parseLessonYearStateDbRow(row);
  }
  return out;
}

export function isMissingLessonMetricsTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("student_lessons_year_metrics") &&
    (m.includes("does not exist") || m.includes("not exist") || m.includes("could not find"))
  );
}
