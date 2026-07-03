import { readYmdParts } from "@/lib/intlFormatParts";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import type { DayTimetableFeePaymentTone, DayTimetableStyleSettings } from "@/lib/dayTimetableStyleSettings";

export const ROOM_GROUPS = ["B", "M前", "M後", "Hope", "Hope 2"] as const;

export type RoomGroup = (typeof ROOM_GROUPS)[number];

/** Canonical room label for schedule matching (B, M前, M後, Hope, Hope 2). */
export function normalizeScheduleRoom(roomRaw: string): RoomGroup | "" {
  const raw = (roomRaw ?? "").trim().toLowerCase();
  if (!raw) return "";
  const compact = raw
    .replace(/\s+/g, "")
    .replace(/[-_]/g, "")
    .replace(/room/g, "")
    .replace(/房間/g, "房");

  if (compact === "b" || compact === "b房") return "B";
  if (compact === "m前" || compact === "m前房" || compact === "mfront" || compact === "m前room") {
    return "M前";
  }
  if (compact === "m後" || compact === "m後房" || compact === "mback" || compact === "m後room") {
    return "M後";
  }
  if (compact === "hope" || compact === "hope房" || compact === "hope1" || compact === "hope1房") {
    return "Hope";
  }
  if (compact === "hope2" || compact === "hope2房") return "Hope 2";

  if (compact.includes("m前") || compact.includes("mfront")) return "M前";
  if (compact.includes("m後") || compact.includes("mback")) return "M後";
  if (compact.includes("hope2")) return "Hope 2";
  if (compact.includes("hope")) return "Hope";
  if (compact === "broom") return "B";

  return "";
}

export function scheduleRoomsMatch(storedRoom: string, expectedRoom: string): boolean {
  const a = normalizeScheduleRoom(storedRoom);
  const b = normalizeScheduleRoom(expectedRoom);
  if (a && b) return a === b;
  return storedRoom.trim() === expectedRoom.trim();
}

/** Canonical label to store in JSON (Hope, not Hope 1). Unknown names are trimmed as-is. */
export function canonicalScheduleRoomLabel(roomRaw: string): string {
  const canonical = normalizeScheduleRoom(roomRaw);
  if (canonical) return canonical;
  return (roomRaw ?? "").trim();
}

/** Map stored room to a standard picker value (Hope 1 → Hope). */
export function resolveScheduleRoomPickerValue(
  roomRaw: string,
  fallback: RoomGroup = ROOM_GROUPS[0],
): RoomGroup {
  const canonical = normalizeScheduleRoom(roomRaw);
  if (canonical) return canonical;
  const trimmed = (roomRaw ?? "").trim();
  if ((ROOM_GROUPS as readonly string[]).includes(trimmed)) return trimmed as RoomGroup;
  return fallback;
}

export type DayTimetableCell = {
  studentId: string;
  name: string;
  grade: string;
  scheduleRemarks: string;
  lessonType: "恆常" | "補堂" | "加堂" | "取消" | typeof PENDING_MAKEUP_TYPE_LABEL;
  /** Leave / pending makeup — e.g. "Make up within 3 days" */
  pendingMakeupLabel?: string;
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

export function redactDayTimetableRemarks(payload: DayTimetablePayload): DayTimetablePayload {
  const byTimeRoom: Record<string, DayTimetableCell[]> = {};
  for (const [key, cells] of Object.entries(payload.byTimeRoom)) {
    byTimeRoom[key] = cells.map((cell) => ({ ...cell, scheduleRemarks: "" }));
  }
  return {
    ...payload,
    timetableRemarksById: {},
    byTimeRoom,
  };
}

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

