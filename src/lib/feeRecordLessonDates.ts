/**
 * Billable lesson dates for the fee record sheet (L columns / expected tuition).
 * Uses yearScheduleCore so reschedule, hidden_dates, and multi-rule days match the lesson pages.
 */

import { readYmdParts } from "@/lib/intlFormatParts";
import { isScheduleAttendanceMarked } from "@/lib/lessonScheduleVersions";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import {
  buildYearScheduleRowsForMonth,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";

const BILLABLE_LESSON_TYPES = new Set<string>([
  "恆常",
  "補堂",
  "加堂",
  PENDING_MAKEUP_TYPE_LABEL,
]);

const HK_WEEKDAY_SHORT_TO_CN: Record<string, string> = {
  Mon: "一",
  Tue: "二",
  Wed: "三",
  Thu: "四",
  Fri: "五",
  Sat: "六",
  Sun: "日",
};

/** "2026-05-08" → "5/8" */
export function isoYmdToMonthDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function toHkIsoDateFromMs(ms: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const { y, m, d } = readYmdParts(parts, { y: "2026", m: "01", d: "01" });
  return `${y}-${m}-${d}`;
}

function sortMonthDayDates(dates: string[]): string[] {
  const copied = [...dates];
  copied.sort((a, b) => {
    const [am, ad] = a.split("/").map((v) => Number(v));
    const [bm, bd] = b.split("/").map((v) => Number(v));
    if (am !== bm) return am - bm;
    return ad - bd;
  });
  return copied;
}

function buildLegacyWeekdayLessonDatesForMonth(params: {
  year: number;
  month1to12: number;
  weekdays: string[];
  extraEntries: Array<{ id: string; date: string }>;
}): string[] {
  const { year, month1to12, weekdays, extraEntries } = params;
  const baseMap: Record<string, string[]> = {
    一: [],
    二: [],
    三: [],
    四: [],
    五: [],
    六: [],
    日: [],
  };
  const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    weekday: "short",
  });
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, month1to12 - 1, d, 12));
    const short = weekdayFormatter.format(dt);
    const cn = HK_WEEKDAY_SHORT_TO_CN[short];
    if (cn) baseMap[cn].push(`${month1to12}/${d}`);
  }

  const base: string[] = [];
  for (const wd of weekdays) {
    base.push(...(baseMap[wd] ?? []));
  }
  for (const e of extraEntries) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
    if (!m) continue;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    if (y === year && mo === month1to12) {
      base.push(`${mo}/${day}`);
    }
  }
  return sortMonthDayDates(Array.from(new Set(base)));
}

export function normalizeFeeLessonRecords(raw: unknown): YearLessonRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item as Record<string, unknown>;
      const weekday = String(o.weekday ?? o.week_day ?? o.weekDay ?? "").trim();
      const room = String(o.room ?? o.classroom ?? o.room_name ?? "").trim();
      const time = String(o.time ?? o.lesson_time ?? "").trim();
      const effectiveDate =
        typeof o.effectiveDate === "string"
          ? o.effectiveDate
          : typeof o.effective_date === "string"
            ? o.effective_date
            : undefined;
      const createdAtRaw = o.createdAt ?? o.created_at ?? 0;
      return {
        id: typeof o.id === "string" ? o.id : undefined,
        effectiveDate,
        weekday,
        time,
        room,
        tutor: typeof o.tutor === "string" ? o.tutor : undefined,
        lessonSummary: typeof o.lessonSummary === "string" ? o.lessonSummary : undefined,
        createdAt: Number(createdAtRaw) || 0,
      } as YearLessonRecord;
    })
    .filter((r) => r.weekday && r.room);
}

export function toYearLessonStateFromClient(state: unknown): YearLessonState {
  const s =
    state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  return {
    attendance: (s.attendance as Record<string, boolean>) ?? {},
    hiddenDates: (s.hiddenDates as Record<string, boolean>) ?? {},
    overrides: (s.overrides as YearLessonState["overrides"]) ?? {},
    rescheduleEntries: (s.rescheduleEntries as YearLessonState["rescheduleEntries"]) ?? [],
    extraEntries: (s.extraEntries as YearLessonState["extraEntries"]) ?? [],
  };
}

/** One entry per billable lesson slot (same calendar day may appear twice). */
export function collectBillableLessonDatesForMonth(params: {
  records: YearLessonRecord[];
  state: YearLessonState;
  year: number;
  month1to12: number;
  /** Used only when schedule records are not loaded yet. */
  legacyWeekdays?: string[];
}): string[] {
  const { records, state, year, month1to12, legacyWeekdays } = params;
  if (records.length === 0) {
    return buildLegacyWeekdayLessonDatesForMonth({
      year,
      month1to12,
      weekdays: legacyWeekdays ?? [],
      extraEntries: state.extraEntries ?? [],
    });
  }

  const rows = buildYearScheduleRowsForMonth(records, state, year, month1to12);
  const dates: string[] = [];
  for (const row of rows) {
    if (!BILLABLE_LESSON_TYPES.has(row.lessonType)) continue;
    dates.push(isoYmdToMonthDay(row.date));
  }
  return sortMonthDayDates(dates);
}

export function normalizeFeeLessonRecordsWithEffectiveDates(raw: unknown): YearLessonRecord[] {
  return normalizeFeeLessonRecords(raw).map((r) => ({
    ...r,
    effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
  }));
}

function countLegacyAttendedLessonsInMonth(params: {
  attendance: Record<string, boolean>;
  year: number;
  month1to12: number;
  extraEntries: Array<{ id: string; date: string }>;
  rescheduleEntries: Array<{ id: string; toDate: string }>;
}): number {
  const { attendance, year, month1to12, extraEntries, rescheduleEntries } = params;
  const prefix = `${year}-${String(month1to12).padStart(2, "0")}`;
  const extraById = new Map(extraEntries.map((e) => [e.id, e]));
  const rescheduleById = new Map(rescheduleEntries.map((r) => [r.id, r]));
  let n = 0;
  for (const [key, v] of Object.entries(attendance)) {
    if (!v) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      if (key.startsWith(prefix)) n += 1;
      continue;
    }
    if (key.startsWith("extra:")) {
      const ex = extraById.get(key.slice("extra:".length));
      if (ex?.date?.startsWith(prefix)) n += 1;
      continue;
    }
    if (key.startsWith("reschedule:")) {
      const r = rescheduleById.get(key.slice("reschedule:".length));
      if (r?.toDate?.startsWith(prefix)) n += 1;
    }
  }
  return n;
}

/** Count attended slots using the same billable rows as collectBillableLessonDatesForMonth. */
export function countAttendedBillableLessonsInMonth(params: {
  records: YearLessonRecord[];
  state: YearLessonState;
  year: number;
  month1to12: number;
}): number {
  const { records, state, year, month1to12 } = params;
  if (records.length === 0) {
    return countLegacyAttendedLessonsInMonth({
      attendance: state.attendance,
      year,
      month1to12,
      extraEntries: state.extraEntries ?? [],
      rescheduleEntries: (state.rescheduleEntries ?? []).map((e) => ({
        id: e.id,
        toDate: e.toDate,
      })),
    });
  }

  const rows = buildYearScheduleRowsForMonth(records, state, year, month1to12);
  let n = 0;
  for (const row of rows) {
    if (!BILLABLE_LESSON_TYPES.has(row.lessonType)) continue;
    if (
      isScheduleAttendanceMarked(state.attendance, {
        attendanceKey: row.attendanceKey,
        dateIso: row.date,
        lessonType: row.lessonType,
        scheduleRuleId: row.scheduleRuleId,
      })
    ) {
      n += 1;
    }
  }
  return n;
}
