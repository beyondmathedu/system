import {
  roomSlotScheduleKey,
  weekdayCnFromIsoDate,
  type RoomSlotTutorRule,
} from "@/lib/roomSlotTutorRules";
import type { YearLessonRecord, YearLessonState } from "@/lib/yearScheduleCore";

/** True if this student might appear on a tutor month sheet (schedule tutor, override, or room-slot default). */
export function hasTutorNameCandidate(
  records: YearLessonRecord[],
  state: YearLessonState,
  nameSet: Set<string>,
  roomSlotTutorRules: RoomSlotTutorRule[] = [],
): boolean {
  for (const r of records) {
    const t = String(r.tutor ?? "").trim();
    if (t && nameSet.has(t)) return true;
  }
  for (const ov of Object.values(state.overrides)) {
    const t = String(ov?.tutor ?? "").trim();
    if (t && nameSet.has(t)) return true;
  }

  if (!roomSlotTutorRules.length || nameSet.size === 0) return false;

  const tutorSlots = new Set<string>();
  for (const rule of roomSlotTutorRules) {
    const tutorName = String(rule.tutor_name ?? "").trim();
    if (tutorName && nameSet.has(tutorName)) {
      tutorSlots.add(roomSlotScheduleKey(rule));
    }
  }
  if (tutorSlots.size === 0) return false;

  for (const r of records) {
    const key = roomSlotScheduleKey({
      weekday: r.weekday,
      time: r.time,
      room: r.room,
    });
    if (key && tutorSlots.has(key)) return true;
  }
  for (const e of state.rescheduleEntries ?? []) {
    const toDate = String(e.toDate ?? "").trim();
    if (!toDate) continue;
    const key = roomSlotScheduleKey({
      weekday: weekdayCnFromIsoDate(toDate),
      time: String(e.time ?? ""),
      room: String(e.room ?? ""),
    });
    if (key && tutorSlots.has(key)) return true;
  }
  for (const e of state.extraEntries ?? []) {
    const date = String(e.date ?? "").trim();
    if (!date) continue;
    const key = roomSlotScheduleKey({
      weekday: weekdayCnFromIsoDate(date),
      time: String(e.time ?? ""),
      room: String(e.room ?? ""),
    });
    if (key && tutorSlots.has(key)) return true;
  }
  return false;
}
