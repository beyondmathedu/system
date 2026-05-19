/**
 * Pure schedule builder (matches student year lesson page logic).
 * No React / no "use client".
 */

import { readYmdParts } from "@/lib/intlFormatParts";
import { gradeRank } from "@/lib/grade";
import { isOnOrAfterLessonSystemStart, normalizeCalendarDateIso } from "@/lib/lessonSystemStart";
import {
  readLessonDayOverrideField,
  tutorDisplayForLessonRow,
} from "@/lib/lessonScheduleVersions";
import {
  isPendingRescheduleEntry,
  PENDING_MAKEUP_TYPE_LABEL,
} from "@/lib/pendingMakeup";

export type YearLessonRecord = {
  id?: string;
  effectiveDate?: string;
  weekday: string;
  time: string;
  room: string;
  tutor?: string;
  lessonSummary?: string;
  createdAt: number;
};

export type YearLessonState = {
  attendance: Record<string, boolean>;
  hiddenDates: Record<string, boolean>;
  overrides: Record<string, { time?: string; room?: string; tutor?: string; lessonSummary?: string }>;
  rescheduleEntries: Array<{
    id: string;
    fromDate: string;
    toDate: string;
    time: string;
    room: string;
    pending?: boolean;
  }>;
  extraEntries: Array<{ id: string; date: string; time: string; room: string }>;
};

export type BuiltScheduleRow = {
  date: string;
  time: string;
  room: string;
  rowKind: "normal" | "cancelled_original" | "reschedule";
  attendanceKey: string;
  rowId: string;
  /** 恆常課對應的課表規則 id（用於 regular:id 出席鍵） */
  scheduleRuleId?: string;
  /** 恆常 / 補堂 / 加堂 / 取消 / Pending makeup（请假补堂日期待定） */
  lessonType: "恆常" | "補堂" | "加堂" | "取消" | typeof PENDING_MAKEUP_TYPE_LABEL;
  tutorDisplay: string;
  noteDisplay: string;
  sortTime: string;
};

type BuildRangeOptions = { month?: number };

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

function sortTimeFromDisplay(time: string) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!m) return time.padStart(5, "0");
  let h = Number(m[1]);
  const min = m[2];
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function buildScheduleRows(
  records: YearLessonRecord[],
  state: YearLessonState,
  targetYear: number,
  options?: BuildRangeOptions,
): BuiltScheduleRow[] {
  const normalized = records.map((r) => ({
    ...r,
    effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
  }));
  const sortedRules = [...normalized].sort((a, b) => {
    const ed = a.effectiveDate.localeCompare(b.effectiveDate);
    if (ed !== 0) return ed;
    return a.createdAt - b.createdAt;
  });

  type Row = {
    date: string;
    time: string;
    room: string;
    rowKind: "normal" | "cancelled_original" | "reschedule";
    attendanceKey: string;
    rowId: string;
    baseRule: (typeof normalized)[0] | null;
    fromExtra: boolean;
  };

  const baseRows: Row[] = [];
  const month = options?.month;
  const hasMonth = Number.isInteger(month) && Number(month) >= 1 && Number(month) <= 12;
  const start = hasMonth ? new Date(targetYear, Number(month) - 1, 1) : new Date(targetYear, 0, 1);
  const end = hasMonth ? new Date(targetYear, Number(month), 0) : new Date(targetYear, 11, 31);
  let ruleIdx = 0;
  let activeRule: (typeof normalized)[0] | null = sortedRules.length > 0 ? sortedRules[0] : null;
  const startIso = toIsoDate(start);
  while (ruleIdx + 1 < sortedRules.length && sortedRules[ruleIdx + 1].effectiveDate <= startIso) {
    ruleIdx += 1;
    activeRule = sortedRules[ruleIdx];
  }

  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const hkNum = getHkWeekdayNumber(cur);
    const weekday = numberToWeekday(hkNum);
    const dateIso = toIsoDate(cur);
    while (ruleIdx + 1 < sortedRules.length && sortedRules[ruleIdx + 1].effectiveDate <= dateIso) {
      ruleIdx += 1;
      activeRule = sortedRules[ruleIdx];
    }
    const rule = activeRule;
    if (!rule) continue;
    if (weekday !== rule.weekday) continue;
    if (state.hiddenDates[dateIso]) continue;

    const ov = state.overrides[dateIso];
    baseRows.push({
      date: dateIso,
      time: (ov?.time ?? rule.time).toString(),
      room: (ov?.room ?? rule.room).toString(),
      rowKind: "normal",
      rowId: `${dateIso}-gen`,
      attendanceKey: dateIso,
      baseRule: rule,
      fromExtra: false,
    });
  }

  const rescheduleByFromDate = new Map<string, (typeof state.rescheduleEntries)[number]>();
  for (const e of state.rescheduleEntries) {
    if (e.fromDate) rescheduleByFromDate.set(e.fromDate, e);
  }
  const rescheduleById = new Map(state.rescheduleEntries.map((e) => [e.id, e]));

  const rows: Row[] = [];
  for (const orig of baseRows) {
    const e = rescheduleByFromDate.get(orig.date);
    if (!e) {
      rows.push({ ...orig });
      continue;
    }
    rows.push({
      ...orig,
      time: orig.baseRule
        ? (state.overrides[e.fromDate]?.time ?? orig.baseRule.time).toString()
        : orig.time,
      room: orig.baseRule
        ? (state.overrides[e.fromDate]?.room ?? orig.baseRule.room).toString()
        : orig.room,
      rowKind: "cancelled_original",
      rowId: `cancelled-${e.id}-${e.fromDate}`,
      attendanceKey: `cancelled:${e.fromDate}:${e.id}`,
      baseRule: orig.baseRule,
      fromExtra: false,
    });
    if (!isPendingRescheduleEntry(e)) {
      rows.push({
        date: e.toDate,
        time: e.time,
        room: e.room,
        rowKind: "reschedule",
        rowId: `reschedule-${e.id}`,
        attendanceKey: `reschedule:${e.id}`,
        baseRule: null,
        fromExtra: false,
      });
    }
  }

  for (const ex of state.extraEntries) {
    rows.push({
      date: ex.date,
      time: ex.time,
      room: ex.room,
      rowKind: "normal",
      rowId: `extra-${ex.id}`,
      attendanceKey: `extra:${ex.id}`,
      baseRule: null,
      fromExtra: true,
    });
  }

  const monthEndIso = toIsoDate(end);
  let visibleRows = rows.filter((r) => isOnOrAfterLessonSystemStart(r.date, targetYear));
  if (hasMonth) {
    visibleRows = visibleRows.filter((r) => {
      const nd = normalizeCalendarDateIso(r.date);
      if (!nd) return false;
      return nd >= startIso && nd <= monthEndIso;
    });
  }

  visibleRows.sort((a, b) => {
    const dc = a.date.localeCompare(b.date);
    if (dc !== 0) return dc;
    const tc = a.time.localeCompare(b.time, "en", { numeric: true });
    if (tc !== 0) return tc;
    return a.rowId.localeCompare(b.rowId);
  });

  return visibleRows.map((r) => {
    let lessonType: BuiltScheduleRow["lessonType"] = "恆常";
    if (r.rowKind === "cancelled_original") {
      const pendingId = /^cancelled-(.+)-/.exec(r.rowId)?.[1];
      const pendingEntry = pendingId ? rescheduleById.get(pendingId) : undefined;
      lessonType =
        pendingEntry && isPendingRescheduleEntry(pendingEntry)
          ? PENDING_MAKEUP_TYPE_LABEL
          : "取消";
    } else if (r.rowKind === "reschedule") lessonType = "補堂";
    else if (r.fromExtra) lessonType = "加堂";

    const tutorDisplay = tutorDisplayForLessonRow({
      overrides: state.overrides,
      dateIso: r.date,
      scheduleRuleTutor: r.baseRule?.tutor,
      pendingLabel: "待定",
    });
    const noteDisplay = readLessonDayOverrideField(state.overrides, r.date, "lessonSummary")
      || String(r.baseRule?.lessonSummary ?? "").trim();

    const sortTime =
      r.time && r.time !== "待定" ? sortTimeFromDisplay(r.time) : "99:99";

    return {
      date: normalizeCalendarDateIso(r.date) ?? r.date,
      time: r.time || "待定",
      room: r.room,
      rowKind: r.rowKind,
      attendanceKey: r.attendanceKey,
      rowId: r.rowId,
      scheduleRuleId: r.baseRule?.id,
      lessonType,
      tutorDisplay,
      noteDisplay,
      sortTime,
    };
  });
}

export function buildYearScheduleRows(
  records: YearLessonRecord[],
  state: YearLessonState,
  targetYear: number,
): BuiltScheduleRow[] {
  return buildScheduleRows(records, state, targetYear);
}

export function buildYearScheduleRowsForMonth(
  records: YearLessonRecord[],
  state: YearLessonState,
  targetYear: number,
  month: number,
): BuiltScheduleRow[] {
  return buildScheduleRows(records, state, targetYear, { month });
}

export function filterRowsByRoomAndMonth(
  rows: BuiltScheduleRow[],
  roomLabel: string,
  month: number,
) {
  return rows.filter((r) => {
    if (r.lessonType === "取消") return false;
    // Pending makeup still shows in the original lesson slot
    if (r.room.trim() !== roomLabel) return false;
    const m = Number(r.date.slice(5, 7));
    return m === month;
  });
}

/** 數字愈小愈前排（日課表、房間聚合等顯示順序） */
export const LESSON_TYPE_DISPLAY_PRIORITY: Record<string, number> = {
  恆常: 1,
  [PENDING_MAKEUP_TYPE_LABEL]: 2,
  補堂: 3,
  加堂: 4,
};
const TYPE_PRIORITY = LESSON_TYPE_DISPLAY_PRIORITY;
export function sortAggregatedRoomRows<
  T extends {
    dateIso: string;
    sortTime: string;
    lessonType: string;
    grade: string;
  },
>(rows: T[]): T[] {
  const copied = [...rows];
  copied.sort((a, b) => {
    if (a.dateIso !== b.dateIso) return a.dateIso.localeCompare(b.dateIso);
    if (a.sortTime !== b.sortTime) return a.sortTime.localeCompare(b.sortTime);
    const pA = TYPE_PRIORITY[a.lessonType] ?? 9;
    const pB = TYPE_PRIORITY[b.lessonType] ?? 9;
    if (pA !== pB) return pA - pB;
    const gA = gradeRank(a.grade);
    const gB = gradeRank(b.grade);
    return gB - gA;
  });
  return copied;
}

export function formatDateSlash(dateIso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return dateIso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

export function weekdayCnParen(dateIso: string) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!p) return "";
  const dt = new Date(Number(p[1]), Number(p[2]) - 1, Number(p[3]));
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return `(${names[dt.getDay()]})`;
}
