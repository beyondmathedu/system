"use client";

import { readYmdParts } from "@/lib/intlFormatParts";

export type Lesson2026Record = {
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

export function getUpcomingUntickedCount(
  records: Lesson2026Record[],
  state: Lesson2026State,
  nowMs = Date.now(),
) {
  const rows = buildRows(records, state);
  const today = new Date(nowMs);
  const startIso = toIsoDate(today);
  const endDate = new Date(today);
  endDate.setMonth(endDate.getMonth() + 2);
  const endIso = toIsoDate(endDate);

  return rows.filter((r) => {
    if (r.rowKind === "cancelled_original") return false;
    if (r.date < startIso || r.date > endIso) return false;
    return !Boolean(state.attendance[r.attendanceKey]);
  }).length;
}

export function getCurrentMonthUntickedCount(
  records: Lesson2026Record[],
  state: Lesson2026State,
  nowMs = Date.now(),
) {
  const rows = buildRows(records, state);
  const now = new Date(nowMs);
  const month = now.getMonth() + 1;

  return rows.filter((r) => {
    if (r.rowKind === "cancelled_original") return false;
    const rowMonth = Number(r.date.slice(5, 7));
    if (rowMonth !== month) return false;
    return !Boolean(state.attendance[r.attendanceKey]);
  }).length;
}

function buildRows(records: Lesson2026Record[], state: Lesson2026State) {
  const normalized = records.map((r) => ({
    ...r,
    effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
  }));
  const sortedRules = [...normalized].sort((a, b) => {
    const ed = a.effectiveDate.localeCompare(b.effectiveDate);
    if (ed !== 0) return ed;
    return a.createdAt - b.createdAt;
  });

  function activeRuleForDate(dateIso: string): (typeof normalized)[0] | null {
    let active: (typeof normalized)[0] | null = null;
    for (const r of sortedRules) {
      if (r.effectiveDate <= dateIso) active = r;
    }
    if (!active && sortedRules.length > 0) active = sortedRules[0];
    return active;
  }

  const baseRows: Row[] = [];
  const start = new Date(2026, 0, 1);
  const end = new Date(2026, 11, 31);

  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const hkNum = getHkWeekdayNumber(cur);
    const weekday = numberToWeekday(hkNum);
    const dateIso = toIsoDate(cur);
    const rule = activeRuleForDate(dateIso);
    if (!rule) continue;
    if (weekday !== rule.weekday) continue;
    if (state.hiddenDates[dateIso]) continue;

    baseRows.push({
      date: dateIso,
      time: (state.overrides[dateIso]?.time ?? rule.time).toString(),
      room: (state.overrides[dateIso]?.room ?? rule.room).toString(),
      rowKind: "normal",
      rowId: `${dateIso}-gen`,
      attendanceKey: dateIso,
    });
  }

  let rows = baseRows.map((r) => ({ ...r }));
  for (const e of state.rescheduleEntries) {
    const idx = rows.findIndex((r) => r.date === e.fromDate && r.rowKind === "normal");
    if (idx === -1) continue;
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
    rows.push({
      date: e.date,
      time: e.time,
      room: e.room,
      rowKind: "normal",
      rowId: `extra-${e.id}`,
      attendanceKey: `extra:${e.id}`,
    });
  }
  return rows;
}
