/**
 * Maps yearScheduleCore rows to the daily / regular timetable cell shape.
 */

import { normalizeScheduleRoom } from "@/lib/dayTimetableShared";
import {
  formatPendingMakeupReminder,
  PENDING_MAKEUP_TYPE_LABEL,
} from "@/lib/pendingMakeup";
import {
  buildYearScheduleRowsForDateRange,
  type BuiltScheduleRow,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";
import type { RoomSlotTutorRule } from "@/lib/roomSlotTutorRules";

export type DayTimetableBuiltRow = {
  date: string;
  time: string;
  room: string;
  lessonType: "恆常" | "補堂" | "加堂" | "取消" | typeof PENDING_MAKEUP_TYPE_LABEL;
  tutorDisplay: string;
  noteDisplay: string;
  pendingMakeupLabel?: string;
};

function weekdayCnFromIsoDate(dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return "";
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return names[dt.getDay()] ?? "";
}

function canonicalSaturdayTime(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const upper = s.toUpperCase();
  if (upper.includes("AM") || upper.includes("PM")) {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s.trim());
    if (!m) return s.trim();
    const hh = String(Number(m[1])).padStart(2, "0");
    return `${hh}:${m[2]} ${m[3].toUpperCase()}`;
  }
  if (s === "10:00") return "10:00 AM";
  if (s === "11:30") return "11:30 AM";
  if (s === "1:00") return "01:00 PM";
  if (s === "2:30") return "02:30 PM";
  return s;
}

function overrideTutorForMaySaturday(opts: {
  dateIso: string;
  normalizedRoom: string;
  time: string;
  tutorDisplay: string;
}): string {
  const { dateIso, normalizedRoom, time, tutorDisplay } = opts;
  if (!dateIso.startsWith("2026-05-")) return tutorDisplay;
  if (weekdayCnFromIsoDate(dateIso) !== "六") return tutorDisplay;

  const t = canonicalSaturdayTime(time);
  if (!t) return tutorDisplay;
  const room = String(normalizedRoom ?? "").trim();

  const map: Record<string, string> = {
    "10:00 AM::Hope": "Leo",
    "10:00 AM::B": "Samuel",
    "10:00 AM::M前": "Howard",
    "11:30 AM::Hope": "Leo",
    "11:30 AM::B": "Samuel",
    "11:30 AM::M前": "Howard",
    "01:00 PM::Hope": "Pammi",
    "01:00 PM::B": "Samuel",
    "01:00 PM::M前": "Frank",
    "01:00 PM::M後": "Matthew",
    "02:30 PM::Hope": "Pammi",
    "02:30 PM::B": "Matthew",
    "02:30 PM::M前": "Frank",
  };
  return map[`${t}::${room}`] ?? tutorDisplay;
}

function yearFromIso(dateIso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  return m ? Number(m[1]) : 2026;
}

function mapCoreRowToDayRow(row: BuiltScheduleRow, todayYmd: string): DayTimetableBuiltRow {
  let pendingMakeupLabel: string | undefined;
  if (row.lessonType === PENDING_MAKEUP_TYPE_LABEL) {
    pendingMakeupLabel = formatPendingMakeupReminder(row.date, todayYmd);
  }

  const tutorDisplay = overrideTutorForMaySaturday({
    dateIso: row.date,
    normalizedRoom: normalizeScheduleRoom(row.room),
    time: row.time || "",
    tutorDisplay: row.tutorDisplay,
  });

  return {
    date: row.date,
    time: row.time || "待定",
    room: row.room,
    lessonType: row.lessonType,
    tutorDisplay,
    noteDisplay: row.noteDisplay,
    pendingMakeupLabel,
  };
}

export function buildDayTimetableRowsForDate(
  records: YearLessonRecord[],
  state: YearLessonState,
  targetDateIso: string,
  todayYmd: string,
  options?: { roomSlotTutorRules?: RoomSlotTutorRule[] },
): DayTimetableBuiltRow[] {
  const year = yearFromIso(targetDateIso);
  const coreRows = buildYearScheduleRowsForDateRange(
    records,
    state,
    year,
    targetDateIso,
    targetDateIso,
    { roomSlotTutorRules: options?.roomSlotTutorRules },
  );
  return coreRows.map((row) => mapCoreRowToDayRow(row, todayYmd));
}
