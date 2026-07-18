import { canonicalScheduleRoomLabel } from "@/lib/dayTimetableShared";
import {
  DEFAULT_LESSON_YEAR_STATE,
  type LessonYearStateField,
  type StudentLesson2026State,
} from "@/lib/lessonYearStateShared";

export function normalizeYearStateRoomsForStorage(state: StudentLesson2026State): StudentLesson2026State {
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state.overrides ?? {})) {
    if (!value || typeof value !== "object") {
      overrides[key] = value;
      continue;
    }
    const row = value as Record<string, unknown>;
    overrides[key] =
      typeof row.room === "string"
        ? { ...row, room: canonicalScheduleRoomLabel(row.room) }
        : value;
  }

  const normalizeRoomArray = (entries: unknown[]) =>
    entries.map((item) => {
      if (!item || typeof item !== "object") return item;
      const row = item as Record<string, unknown>;
      return typeof row.room === "string"
        ? { ...row, room: canonicalScheduleRoomLabel(row.room) }
        : item;
    });

  return {
    ...state,
    overrides,
    rescheduleEntries: normalizeRoomArray(state.rescheduleEntries ?? []),
    extraEntries: normalizeRoomArray(state.extraEntries ?? []),
  };
}

export function buildLessonYearStateUpsertRow(
  studentId: string,
  year: number,
  patch: Partial<StudentLesson2026State>,
  fields: readonly LessonYearStateField[],
): Record<string, unknown> | null {
  if (!fields.length) return null;

  const normalized = normalizeYearStateRoomsForStorage({
    ...DEFAULT_LESSON_YEAR_STATE,
    ...patch,
  });

  const payload: Record<string, unknown> = {
    student_id: studentId,
    year,
    updated_at: new Date().toISOString(),
  };

  for (const field of fields) {
    switch (field) {
      case "attendance":
        payload.attendance = normalized.attendance;
        break;
      case "hiddenDates":
        payload.hidden_dates = normalized.hiddenDates;
        break;
      case "overrides":
        payload.overrides = normalized.overrides;
        break;
      case "rescheduleEntries":
        payload.reschedule_entries = normalized.rescheduleEntries;
        break;
      case "extraEntries":
        payload.extra_entries = normalized.extraEntries;
        break;
      default: {
        const _exhaustive: never = field;
        return _exhaustive;
      }
    }
  }

  return payload;
}

export function lessonYearStateFieldsUnchanged(
  state: StudentLesson2026State,
  fields: readonly LessonYearStateField[],
  lastSaved: StudentLesson2026State | undefined,
): boolean {
  if (!lastSaved) return false;
  return fields.every((field) => JSON.stringify(state[field]) === JSON.stringify(lastSaved[field]));
}

export function patchFromLessonYearState(
  state: StudentLesson2026State,
  fields: Iterable<LessonYearStateField>,
): Partial<StudentLesson2026State> {
  const patch: Partial<StudentLesson2026State> = {};
  for (const field of fields) {
    patch[field] = state[field] as never;
  }
  return patch;
}

/** Keys whose boolean attendance value changed (for RPC patch payloads). */
export function attendanceRecordDelta(
  next: Record<string, boolean>,
  last: Record<string, boolean> | undefined,
): Record<string, boolean> {
  const prev = last ?? {};
  const delta: Record<string, boolean> = {};
  const keys = new Set([...Object.keys(next), ...Object.keys(prev)]);
  for (const k of keys) {
    if (Boolean(next[k]) !== Boolean(prev[k])) {
      delta[k] = Boolean(next[k]);
    }
  }
  return delta;
}

export function buildAttendancePatchFromKeys(
  attendance: Record<string, boolean>,
  keys: Iterable<string>,
): Record<string, boolean> {
  const patch: Record<string, boolean> = {};
  for (const key of keys) {
    if (!key) continue;
    patch[key] = Boolean(attendance[key]);
  }
  return patch;
}

export function isMissingAttendancePatchRpcError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("patch_lesson_year_attendance") &&
    (m.includes("does not exist") ||
      m.includes("not find") ||
      m.includes("could not find") ||
      m.includes("schema cache"))
  );
}

export function isMissingOverridesPatchRpcError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("patch_lesson_year_overrides") &&
    (m.includes("does not exist") ||
      m.includes("not find") ||
      m.includes("could not find") ||
      m.includes("schema cache"))
  );
}

/** Smallest overrides JSON for RPC merge (per-date keys only). */
export function buildOverridesPatchFromKeys(
  overrides: Record<string, unknown>,
  keys: Iterable<string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (!key) continue;
    if (overrides[key] !== undefined) patch[key] = overrides[key];
  }
  return patch;
}
