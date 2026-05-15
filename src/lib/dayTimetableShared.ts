import { readYmdParts } from "@/lib/intlFormatParts";
import type { DayTimetableFeePaymentTone, DayTimetableStyleSettings } from "@/lib/dayTimetableStyleSettings";

export const ROOM_GROUPS = ["B", "M前", "M後", "Hope", "Hope 2"] as const;

export type RoomGroup = (typeof ROOM_GROUPS)[number];

export type DayTimetableCell = {
  studentId: string;
  name: string;
  grade: string;
  scheduleRemarks: string;
  lessonType: "恆常" | "補堂" | "加堂" | "取消";
  tutorDisplay: string;
  tutorColorHex?: string;
};

export type DayTimetableRowFrame = { time: string; maxRows: number };

export type DayTimetablePayload = {
  year: number;
  month: number;
  day: number;
  dateIso: string;
  titleDate: string;
  examById: Record<string, string>;
  timetableRemarksById: Record<string, string>;
  byTimeRoom: Record<string, DayTimetableCell[]>;
  rowFrames: DayTimetableRowFrame[];
  regularPeriodMaxByRoom: Record<RoomGroup, number>;
  feePaymentToneByStudentId: Record<string, DayTimetableFeePaymentTone>;
  timetableStyle: DayTimetableStyleSettings;
};

export function hkTodayYmd() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const { y: ys, m: ms, d: ds } = readYmdParts(parts, { y: "2026", m: "01", d: "01" });
  return { y: Number(ys) || 2026, m: Number(ms) || 1, d: Number(ds) || 1 };
}

export function parseDayParams(sp: { year?: string; month?: string; day?: string } | undefined) {
  const now = hkTodayYmd();
  const year = Number(sp?.year ?? now.y) || now.y;
  const month = Math.min(12, Math.max(1, Number(sp?.month ?? now.m) || now.m));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(daysInMonth, Math.max(1, Number(sp?.day ?? now.d) || now.d));
  return { year, month, day, daysInMonth };
}

export function toDayIso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

