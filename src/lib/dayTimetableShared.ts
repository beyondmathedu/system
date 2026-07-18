import { readYmdParts } from "@/lib/intlFormatParts";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import type { DayTimetableFeePaymentTone, DayTimetableStyleSettings } from "@/lib/dayTimetableStyleSettings";
import {
  DEFAULT_ROOM_DISPLAY_REGISTRY,
  resolveRoomGroupFromRegistry,
  type RoomDisplayRegistry,
} from "@/lib/roomDisplayRegistry";
import { normalizeScheduleRoom, ROOM_GROUPS, type RoomGroup } from "@/lib/roomGroups";

export { normalizeScheduleRoom, ROOM_GROUPS, type RoomGroup };

export function scheduleRoomsMatch(
  storedRoom: string,
  expectedRoom: string,
  registry: RoomDisplayRegistry = DEFAULT_ROOM_DISPLAY_REGISTRY,
): boolean {
  if (storedRoom.trim() === expectedRoom.trim()) return true;
  const a = resolveRoomGroupFromRegistry(storedRoom, registry);
  const b = resolveRoomGroupFromRegistry(expectedRoom, registry);
  if (a && b) return a === b;
  return false;
}

/** Canonical label to store in JSON (Hope, not Hope 1). Unknown names are trimmed as-is. */
export function canonicalScheduleRoomLabel(roomRaw: string): string {
  const canonical = normalizeScheduleRoom(roomRaw);
  if (canonical) return canonical;
  return (roomRaw ?? "").trim();
}

/** Canonical display time for schedule slot matching (e.g. `3:00 PM` → `03:00 PM`). */
export function canonicalScheduleTimeLabel(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s);
  if (m) {
    const hh = String(Number(m[1])).padStart(2, "0");
    return `${hh}:${m[2]} ${m[3].toUpperCase()}`;
  }
  if (s === "10:00") return "10:00 AM";
  if (s === "11:30") return "11:30 AM";
  if (s === "1:00" || s === "13:00") return "01:00 PM";
  if (s === "2:30" || s === "14:30") return "02:30 PM";
  if (s === "3:00" || s === "15:00") return "03:00 PM";
  if (s === "4:30" || s === "16:30") return "04:30 PM";
  if (s === "6:00" || s === "18:00") return "06:00 PM";
  return s;
}

/** Map stored room to a standard picker value (Hope 1 → Hope). */
export function resolveScheduleRoomPickerValue(
  roomRaw: string,
  fallback: RoomGroup = ROOM_GROUPS[0],
  registry: RoomDisplayRegistry = DEFAULT_ROOM_DISPLAY_REGISTRY,
): RoomGroup {
  const fromRegistry = resolveRoomGroupFromRegistry(roomRaw, registry);
  if (fromRegistry) return fromRegistry;
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
  /** Leave / pending makeup — e.g. "Makeup until end of June" */
  pendingMakeupLabel?: string;
  /** Inactive / pause on this date; keeps regular slot for capacity planning */
  isInactive?: boolean;
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
  roomDisplayLabels: Record<RoomGroup, string>;
  feePaymentToneByStudentId: Record<string, DayTimetableFeePaymentTone>;
  timetableStyle: DayTimetableStyleSettings;
};

/** Regular timetable page: filter rows shown below the heading. */
export type RegularTimetableLessonView =
  | "regular"
  | "all"
  | "extra"
  | "reschedule"
  | "inactive";

const REGULAR_TIMETABLE_REGULAR_TYPES = new Set<string>(["恆常", PENDING_MAKEUP_TYPE_LABEL]);

function regularTimetableCellMatchesView(
  cell: DayTimetableCell,
  view: RegularTimetableLessonView,
): boolean {
  if (cell.lessonType === "取消") return false;
  const isPaused = Boolean(cell.isInactive);
  const isRegular = !isPaused && REGULAR_TIMETABLE_REGULAR_TYPES.has(cell.lessonType);
  switch (view) {
    case "regular":
      // Regular only (active)
      return isRegular;
    case "all":
      // Regular + Extra + Reschedule + Inactive
      return (
        isRegular ||
        isPaused ||
        cell.lessonType === "加堂" ||
        cell.lessonType === "補堂"
      );
    case "extra":
      // Regular + Extra
      return isRegular || cell.lessonType === "加堂";
    case "reschedule":
      // Regular + Reschedule
      return isRegular || cell.lessonType === "補堂";
    case "inactive":
      // Regular + Inactive (paused keep-slot)
      return isRegular || isPaused;
    default:
      return false;
  }
}

/** Keep time slots / maxRows in sync after filtering lesson types client-side. */
export function filterDayTimetablePayloadByLessonView(
  payload: DayTimetablePayload,
  view: RegularTimetableLessonView,
): DayTimetablePayload {
  const byTimeRoom: Record<string, DayTimetableCell[]> = {};
  for (const [key, cells] of Object.entries(payload.byTimeRoom)) {
    const filtered = cells.filter((c) => regularTimetableCellMatchesView(c, view));
    if (filtered.length > 0) byTimeRoom[key] = filtered;
  }

  const rowFrames: DayTimetableRowFrame[] = [];
  for (const frame of payload.rowFrames) {
    let maxRows = 0;
    for (const room of ROOM_GROUPS) {
      const size = (byTimeRoom[`${frame.time}::${room}`] ?? []).length;
      if (size > maxRows) maxRows = size;
    }
    if (maxRows > 0) rowFrames.push({ time: frame.time, maxRows });
  }

  return {
    ...payload,
    byTimeRoom,
    rowFrames,
  };
}

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

/** Weekday 一–日 for a calendar date in Hong Kong. */
export function weekdayCnFromIsoDateHk(dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return "";
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    weekday: "short",
  }).format(dt);
  const map: Record<string, string> = {
    Mon: "一",
    Tue: "二",
    Wed: "三",
    Thu: "四",
    Fri: "五",
    Sat: "六",
    Sun: "日",
  };
  return map[short] ?? "";
}

