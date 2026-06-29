import { scheduleRoomsMatch } from "@/lib/dayTimetableShared";
import type { YearLessonRecord, YearLessonState } from "@/lib/yearScheduleCore";

export type RoomStateSignals = Pick<
  YearLessonState,
  "overrides" | "rescheduleEntries" | "extraEntries"
>;

export function hasRoomScheduleCandidateFromRecords(
  records: YearLessonRecord[],
  roomLabel: string,
): boolean {
  const target = roomLabel.trim();
  if (!target) return false;
  for (const r of records) {
    if (scheduleRoomsMatch(String(r.room ?? ""), target)) return true;
  }
  return false;
}

export function hasRoomScheduleCandidateFromStateSignals(
  state: RoomStateSignals,
  roomLabel: string,
): boolean {
  const target = roomLabel.trim();
  if (!target) return false;
  for (const ov of Object.values(state.overrides ?? {})) {
    if (scheduleRoomsMatch(String(ov?.room ?? ""), target)) return true;
  }
  for (const e of state.extraEntries ?? []) {
    if (scheduleRoomsMatch(String(e.room ?? ""), target)) return true;
  }
  for (const e of state.rescheduleEntries ?? []) {
    if (scheduleRoomsMatch(String(e.room ?? ""), target)) return true;
  }
  return false;
}

export function hasRoomScheduleCandidate(
  records: YearLessonRecord[],
  state: YearLessonState,
  roomLabel: string,
): boolean {
  return (
    hasRoomScheduleCandidateFromRecords(records, roomLabel) ||
    hasRoomScheduleCandidateFromStateSignals(state, roomLabel)
  );
}

export function isEmptyRoomStateSignals(state: RoomStateSignals | undefined): boolean {
  if (!state) return true;
  return (
    Object.keys(state.overrides ?? {}).length === 0 &&
    (state.rescheduleEntries ?? []).length === 0 &&
    (state.extraEntries ?? []).length === 0
  );
}
