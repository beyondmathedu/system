import { isOnOrAfterLessonSystemStart } from "@/lib/lessonSystemStart";
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

function filterUntickedRowsInMakeupWindow(
  rows: BuiltScheduleRow[],
  state: Lesson2026State,
  startIso: string,
  endIso: string,
) {
  return rows.filter((r) => {
    if (r.rowKind === "cancelled_original") return false;
    if (r.date < startIso || r.date > endIso) return false;
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
): LessonUntickedMetrics {
  const rows = buildYearScheduleRows(records, state, calendarYear);
  const { startIso, endIso } = getPriorMonthMakeupWindow(nowMs, calendarYear);
  const makeupRows = filterUntickedRowsInMakeupWindow(rows, state, startIso, endIso);
  const now = new Date(nowMs);
  const month = now.getMonth() + 1;
  const currentMonthUntickedCount = rows.filter((r) => {
    if (r.rowKind === "cancelled_original") return false;
    if (!isOnOrAfterLessonSystemStart(r.date, calendarYear)) return false;
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
) {
  return getLessonUntickedMetrics(records, state, nowMs, calendarYear).makeupCount;
}

export function getCurrentMonthUntickedCount(
  records: Lesson2026Record[],
  state: Lesson2026State,
  nowMs = Date.now(),
  calendarYear = 2026,
) {
  return getLessonUntickedMetrics(records, state, nowMs, calendarYear).currentMonthUntickedCount;
}

/** ISO dates (YYYY-MM-DD) of unticked lessons in the prior calendar month (same window as Makeup Count). */
export function getUpcomingUntickedDates(
  records: Lesson2026Record[],
  state: Lesson2026State,
  nowMs = Date.now(),
  calendarYear = 2026,
): string[] {
  const { startIso, endIso } = getPriorMonthMakeupWindow(nowMs, calendarYear);
  const rows = buildYearScheduleRowsForDateRange(records, state, calendarYear, startIso, endIso);
  return filterUntickedRowsInMakeupWindow(rows, state, startIso, endIso)
    .map((r) => r.date)
    .sort();
}
