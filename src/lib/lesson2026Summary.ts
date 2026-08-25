import { isOnOrAfterLessonSystemStart } from "@/lib/lessonSystemStart";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import { getPriorMonthMakeupWindow } from "@/lib/priorMonthMakeupWindow";
import {
  buildYearScheduleRows,
  buildYearScheduleRowsForDateRange,
  type BuiltScheduleRow,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";
import { isScheduleAttendanceMarked } from "@/lib/lessonScheduleVersions";

export { getPriorMonthMakeupWindow } from "@/lib/priorMonthMakeupWindow";

export type Lesson2026Record = YearLessonRecord;

export type Lesson2026State = YearLessonState;

function isRowMarkedAttended(r: BuiltScheduleRow, state: Lesson2026State): boolean {
  if (r.rowKind === "cancelled_original") return false;
  const lt = r.lessonType;
  if (lt !== "恆常" && lt !== "補堂" && lt !== "加堂") return false;
  return isScheduleAttendanceMarked(state.attendance, {
    attendanceKey: r.attendanceKey,
    dateIso: r.date,
    lessonType: lt,
    scheduleRuleId: r.scheduleRuleId,
  });
}

export type LessonUntickedOptions = {
  /** Inactive / holiday pause days are not owed makeup (same as fee-record billable exclusion). */
  isDateInactive?: (dateIso: string) => boolean;
};

function filterUntickedRowsInMakeupWindow(
  rows: BuiltScheduleRow[],
  state: Lesson2026State,
  startIso: string,
  endIso: string,
  isDateInactive?: (dateIso: string) => boolean,
) {
  return rows.filter((r) => {
    if (r.date < startIso || r.date > endIso) return false;
    if (isDateInactive?.(r.date)) return false;
    if (r.rowKind === "cancelled_original") {
      // Pending makeup = missed lesson not yet rescheduled; still counts as makeup owed.
      return r.lessonType === PENDING_MAKEUP_TYPE_LABEL;
    }
    return !isRowMarkedAttended(r, state);
  });
}

export type LessonUntickedMetrics = {
  makeupCount: number;
  makeupDates: string[];
  currentMonthUntickedCount: number;
};

/** 只 buildRows 一次，同時算補堂與當月未打勾。 */
export function getLessonUntickedMetrics(
  records: Lesson2026Record[],
  state: Lesson2026State,
  nowMs = Date.now(),
  calendarYear = 2026,
  options?: LessonUntickedOptions,
): LessonUntickedMetrics {
  const rows = buildYearScheduleRows(records, state, calendarYear);
  const { startIso, endIso } = getPriorMonthMakeupWindow(nowMs, calendarYear);
  const makeupRows = filterUntickedRowsInMakeupWindow(
    rows,
    state,
    startIso,
    endIso,
    options?.isDateInactive,
  );
  const now = new Date(nowMs);
  const month = now.getMonth() + 1;
  const currentMonthUntickedCount = rows.filter((r) => {
    if (r.rowKind === "cancelled_original") return false;
    if (!isOnOrAfterLessonSystemStart(r.date, calendarYear)) return false;
    if (options?.isDateInactive?.(r.date)) return false;
    const rowMonth = Number(r.date.slice(5, 7));
    if (rowMonth !== month) return false;
    return !isRowMarkedAttended(r, state);
  }).length;
  return {
    makeupCount: makeupRows.length,
    makeupDates: makeupRows.map((r) => r.date).sort(),
    currentMonthUntickedCount,
  };
}

export function getUpcomingUntickedCount(
  records: Lesson2026Record[],
  state: Lesson2026State,
  nowMs = Date.now(),
  calendarYear = 2026,
  options?: LessonUntickedOptions,
) {
  return getLessonUntickedMetrics(records, state, nowMs, calendarYear, options).makeupCount;
}

export function getCurrentMonthUntickedCount(
  records: Lesson2026Record[],
  state: Lesson2026State,
  nowMs = Date.now(),
  calendarYear = 2026,
  options?: LessonUntickedOptions,
) {
  return getLessonUntickedMetrics(records, state, nowMs, calendarYear, options)
    .currentMonthUntickedCount;
}

/** ISO dates (YYYY-MM-DD) of unticked lessons in the prior calendar month (same window as Makeup Count). */
export function getUpcomingUntickedDates(
  records: Lesson2026Record[],
  state: Lesson2026State,
  nowMs = Date.now(),
  calendarYear = 2026,
  options?: LessonUntickedOptions,
): string[] {
  const { startIso, endIso } = getPriorMonthMakeupWindow(nowMs, calendarYear);
  const rows = buildYearScheduleRowsForDateRange(records, state, calendarYear, startIso, endIso);
  return filterUntickedRowsInMakeupWindow(rows, state, startIso, endIso, options?.isDateInactive)
    .map((r) => r.date)
    .sort();
}

/**
 * 區間內未打勾的堂（恆常／補堂／加堂）。
 * 不含請假待定、已取消原堂；inactive 日可排除。
 */
export function listUntickedRegularMakeupExtraInRange(
  records: Lesson2026Record[],
  state: Lesson2026State,
  startIso: string,
  endIso: string,
  calendarYear = 2026,
  options?: LessonUntickedOptions,
): BuiltScheduleRow[] {
  if (startIso > endIso) return [];
  const rows = buildYearScheduleRowsForDateRange(records, state, calendarYear, startIso, endIso);
  return rows
    .filter((r) => {
      if (r.date < startIso || r.date > endIso) return false;
      if (options?.isDateInactive?.(r.date)) return false;
      if (r.rowKind === "cancelled_original") return false;
      return !isRowMarkedAttended(r, state);
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.sortTime.localeCompare(b.sortTime));
}
