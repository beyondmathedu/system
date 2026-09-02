import {
  roomSlotScheduleKey,
  weekdayCnFromIsoDate,
  type RoomSlotTutorRule,
} from "@/lib/roomSlotTutorRules";
import { normalizeScheduleWeekday } from "@/lib/lessonScheduleVersions";
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

  const ruleMatchesTutorSlot = (weekday: string, time: string, room: string): boolean => {
    const key = roomSlotScheduleKey({ weekday, time, room });
    return Boolean(key && tutorSlots.has(key));
  };

  for (const r of records) {
    const weekday = normalizeScheduleWeekday(r.weekday);
    const time = String(r.time ?? "").trim();
    const room = String(r.room ?? "").trim();
    if (ruleMatchesTutorSlot(weekday, time, room)) return true;

    // Day override may move the student to another room (and thus another tutor) on that weekday.
    for (const [dateIso, ovRaw] of Object.entries(state.overrides ?? {})) {
      const ov = ovRaw as { room?: string; time?: string };
      const ovRoom = String(ov?.room ?? "").trim();
      if (!ovRoom) continue;
      if (weekdayCnFromIsoDate(dateIso) !== weekday) continue;
      const ovTime = String(ov?.time ?? time).trim();
      if (ruleMatchesTutorSlot(weekday, ovTime, ovRoom)) return true;
    }
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
