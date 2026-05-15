"use client";

import { readYmdParts } from "@/lib/intlFormatParts";
import {
  getLessonSystemStartDate,
  isOnOrAfterLessonSystemStart,
} from "@/lib/lessonSystemStart";
import { getPriorMonthMakeupWindow } from "@/lib/priorMonthMakeupWindow";

export { getPriorMonthMakeupWindow } from "@/lib/priorMonthMakeupWindow";
import {
  getActiveScheduleRulesForDate,
  isRegularLessonAttended,
  regularLessonAttendanceKey,
} from "@/lib/lessonScheduleVersions";

export type Lesson2026Record = {
  id?: string;
  effectiveDate?: string;
  weekday: string;
  time: string;
  room: string;
  tutor?: string;
  lessonSummary?: string;
  createdAt: number;
};

export type Lesson2026State = {
  attendance: Record<string, boolean>;
  hiddenDates: Record<string, boolean>;
  overrides: Record<string, { time?: string; room?: string; tutor?: string; lessonSummary?: string }>;
  rescheduleEntries: Array<{ id: string; fromDate: string; toDate: string; time: string; room: string }>;
  extraEntries: Array<{ id: string; date: string; time: string; room: string }>;
};

type Row = {
  date: string;
  time: string;
  room: string;
  rowKind: "normal" | "cancelled_original" | "reschedule";
  attendanceKey: string;
  rowId: string;
};

function numberToWeekday(num: number) {
  switch (num) {
    case 1:
      return "一";
    case 2:
      return "二";
    case 3:
      return "三";
    case 4:
      return "四";
    case 5:
      return "五";
    case 6:
      return "六";
    case 7:
      return "日";
    default:
      return "";
  }
}

function toIsoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toHkIsoDateFromMs(ms: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));

  const { y, m, d } = readYmdParts(parts);
  return `${y}-${m}-${d}`;
}

function getHkWeekdayNumber(d: Date) {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function isRowMarkedAttended(r: Row, state: Lesson2026State): boolean {
  if (Boolean(state.attendance[r.attendanceKey])) return true;
  if (r.rowKind === "normal" && r.attendanceKey.startsWith("regular:")) {
    const ruleId = r.attendanceKey.slice("regular:".length);
    return isRegularLessonAttended(state.attendance, { id: ruleId }, r.date);
  }
  return Boolean(state.attendance[r.date]);
}

function filterUntickedRowsInMakeupWindow(
  rows: Row[],
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
  const rows = buildRows(records, state, calendarYear);
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

function buildRows(records: Lesson2026Record[], state: Lesson2026State, calendarYear: number) {
  const normalized = records.map((r) => ({
    ...r,
    effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
  }));
  const sortedRules = [...normalized].sort((a, b) => {
    const ed = a.effectiveDate.localeCompare(b.effectiveDate);
    if (ed !== 0) return ed;
    return a.createdAt - b.createdAt;
  });
  const baseRows: Row[] = [];
  const start = getLessonSystemStartDate(calendarYear);
  const end = new Date(calendarYear, 11, 31);
  const versionCache = new Map<string, (typeof normalized)[0][]>();

  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const hkNum = getHkWeekdayNumber(cur);
    const weekday = numberToWeekday(hkNum);
    const dateIso = toIsoDate(cur);
    if (state.hiddenDates[dateIso]) continue;

    const activeRules = getActiveScheduleRulesForDate(sortedRules, dateIso, versionCache);
    for (const rule of activeRules) {
      if (rule.weekday !== weekday) continue;
      const attendanceKey = regularLessonAttendanceKey(rule, dateIso);
      baseRows.push({
        date: dateIso,
        time: (state.overrides[dateIso]?.time ?? rule.time).toString(),
        room: (state.overrides[dateIso]?.room ?? rule.room).toString(),
        rowKind: "normal",
        rowId: `${dateIso}-regular-${rule.id ?? `${rule.time}-${rule.room}`}`,
        attendanceKey,
      });
    }
  }

  let rows = baseRows.map((r) => ({ ...r }));
  for (const e of state.rescheduleEntries) {
    if (!isOnOrAfterLessonSystemStart(e.toDate, calendarYear)) continue;
    const idx = rows.findIndex((r) => r.date === e.fromDate && r.rowKind === "normal");
    if (idx === -1) {
      rows.push({
        date: e.toDate,
        time: e.time,
        room: e.room,
        rowKind: "reschedule",
        rowId: `reschedule-${e.id}`,
        attendanceKey: `reschedule:${e.id}`,
      });
      continue;
    }
    const orig = rows[idx];
    rows.splice(idx, 1, {
      ...orig,
      rowKind: "cancelled_original",
      rowId: `cancelled-${e.id}-${e.fromDate}`,
      attendanceKey: `cancelled:${e.fromDate}:${e.id}`,
    });
    rows.splice(idx + 1, 0, {
      date: e.toDate,
      time: e.time,
      room: e.room,
      rowKind: "reschedule",
      rowId: `reschedule-${e.id}`,
      attendanceKey: `reschedule:${e.id}`,
    });
  }

  for (const e of state.extraEntries) {
    if (!isOnOrAfterLessonSystemStart(e.date, calendarYear)) continue;
    rows.push({
      date: e.date,
      time: e.time,
      room: e.room,
      rowKind: "normal",
      rowId: `extra-${e.id}`,
      attendanceKey: `extra:${e.id}`,
    });
  }
  return rows.filter((r) => isOnOrAfterLessonSystemStart(r.date, calendarYear));
}

/** ISO dates (YYYY-MM-DD) of unticked lessons in the prior calendar month (same window as Makeup Count). */
export function getUpcomingUntickedDates(
  records: Lesson2026Record[],
  state: Lesson2026State,
  nowMs = Date.now(),
  calendarYear = 2026,
): string[] {
  const rows = buildRows(records, state, calendarYear);
  const { startIso, endIso } = getPriorMonthMakeupWindow(nowMs, calendarYear);
  return filterUntickedRowsInMakeupWindow(rows, state, startIso, endIso)
    .map((r) => r.date)
    .sort();
}
