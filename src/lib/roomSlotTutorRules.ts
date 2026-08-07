import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { canonicalScheduleRoomLabel, canonicalScheduleTimeLabel, ROOM_GROUPS } from "@/lib/dayTimetableShared";
import { normalizeScheduleWeekday } from "@/lib/lessonScheduleVersions";
import { SCHEDULE_CACHE_TAG_DAY_TIMETABLE } from "@/lib/scheduleCacheTags";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type RoomSlotTutorRule = {
  id: string;
  room: string;
  weekday: string;
  time: string;
  tutor_name: string;
  effective_date: string;
};

export const ROOM_SLOT_WEEKDAY_OPTIONS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/** Mon–Fri regular slots (matches student lesson schedule). */
export const WEEKDAY_SLOT_TIME_SUGGESTIONS = ["03:00 PM", "04:30 PM", "06:00 PM"] as const;

/** Saturday regular slots. */
export const SATURDAY_SLOT_TIME_SUGGESTIONS = ["10:00 AM", "11:30 AM", "01:00 PM", "02:30 PM"] as const;

/** @deprecated Use timeSuggestionsForScheduleWeekday instead. */
export const ROOM_SLOT_TIME_SUGGESTIONS = [
  ...SATURDAY_SLOT_TIME_SUGGESTIONS,
  ...WEEKDAY_SLOT_TIME_SUGGESTIONS,
] as const;

export function timeSuggestionsForScheduleWeekday(weekday: string): readonly string[] {
  const wd = normalizeScheduleWeekday(weekday);
  if (wd === "六") return SATURDAY_SLOT_TIME_SUGGESTIONS;
  if (wd === "日") return [];
  if (["一", "二", "三", "四", "五"].includes(wd)) return WEEKDAY_SLOT_TIME_SUGGESTIONS;
  return [];
}

export function roomSlotScheduleKey(rule: { weekday: string; time: string; room: string }): string {
  return `${normalizeScheduleWeekday(rule.weekday)}|${canonicalScheduleTimeLabel(rule.time)}|${canonicalScheduleRoomLabel(rule.room)}`;
}

export function weekdayCnFromIsoDate(dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateIso ?? "").trim());
  if (!m) return "";
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return names[dt.getDay()] ?? "";
}

export function normalizeRoomSlotRuleRow(row: Record<string, unknown>): RoomSlotTutorRule | null {
  const room = canonicalScheduleRoomLabel(String(row.room ?? ""));
  const weekday = normalizeScheduleWeekday(row.weekday);
  const time = canonicalScheduleTimeLabel(String(row.time ?? ""));
  const tutor_name = String(row.tutor_name ?? "").trim();
  const effective_date = String(row.effective_date ?? "").trim();
  const id = String(row.id ?? "").trim();
  if (!room || !weekday || !time || !tutor_name || !/^\d{4}-\d{2}-\d{2}$/.test(effective_date) || !id) {
    return null;
  }
  return { id, room, weekday, time, tutor_name, effective_date };
}

/** Latest rule for slot with effective_date <= dateIso. */
export function resolveRoomSlotTutorForDate(
  rules: RoomSlotTutorRule[],
  input: { room: string; weekday: string; time: string; dateIso: string },
): string | undefined {
  const key = roomSlotScheduleKey({
    weekday: normalizeScheduleWeekday(input.weekday),
    time: input.time,
    room: canonicalScheduleRoomLabel(input.room),
  });
  const dateIso = String(input.dateIso ?? "").trim();
  if (!key || !dateIso) return undefined;

  let best: RoomSlotTutorRule | null = null;
  for (const rule of rules) {
    if (roomSlotScheduleKey(rule) !== key) continue;
    if (rule.effective_date > dateIso) continue;
    if (!best || rule.effective_date > best.effective_date) best = rule;
  }
  return best?.tutor_name.trim() || undefined;
}

export function resolveRoomSlotTutorForLessonRow(
  rules: RoomSlotTutorRule[] | undefined,
  input: { room: string; time: string; dateIso: string; weekday?: string },
): string | undefined {
  if (!rules?.length) return undefined;
  const weekday = normalizeScheduleWeekday(input.weekday ?? weekdayCnFromIsoDate(input.dateIso));
  return resolveRoomSlotTutorForDate(rules, {
    room: input.room,
    weekday,
    time: input.time,
    dateIso: input.dateIso,
  });
}

export async function loadRoomSlotTutorRulesServer(
  supabase: SupabaseClient,
): Promise<RoomSlotTutorRule[]> {
  const { data, error } = await supabase
    .from("room_slot_tutor_rules")
    .select("id, room, weekday, time, tutor_name, effective_date")
    .order("room")
    .order("weekday")
    .order("time")
    .order("effective_date", { ascending: true });

  if (error) {
    if (/room_slot_tutor_rules/i.test(error.message) && /does not exist/i.test(error.message)) {
      return [];
    }
    throw new Error(error.message);
  }

  const out: RoomSlotTutorRule[] = [];
  for (const row of data ?? []) {
    const normalized = normalizeRoomSlotRuleRow(row as Record<string, unknown>);
    if (normalized) out.push(normalized);
  }
  return out;
}

/** Cached room→slot tutor map (invalidated with day-timetable tag). */
export async function loadRoomSlotTutorRulesCached(): Promise<RoomSlotTutorRule[]> {
  return unstable_cache(
    () => loadRoomSlotTutorRulesServer(getSupabaseAdmin()),
    ["room-slot-tutor-rules-v1"],
    { revalidate: 300, tags: [SCHEDULE_CACHE_TAG_DAY_TIMETABLE] },
  )();
}

export async function upsertRoomSlotTutorRule(
  supabase: SupabaseClient,
  input: Omit<RoomSlotTutorRule, "id"> & { id?: string },
): Promise<void> {
  const room = canonicalScheduleRoomLabel(input.room);
  const weekday = normalizeScheduleWeekday(input.weekday);
  const time = canonicalScheduleTimeLabel(String(input.time ?? ""));
  const tutor_name = String(input.tutor_name ?? "").trim();
  const effective_date = String(input.effective_date ?? "").trim();
  if (!room || !weekday || !time || !tutor_name || !/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) {
    throw new Error("Invalid room slot tutor rule");
  }
  if (!ROOM_GROUPS.includes(room as (typeof ROOM_GROUPS)[number])) {
    throw new Error("Invalid room");
  }

  const { error } = await supabase.from("room_slot_tutor_rules").upsert(
    { room, weekday, time, tutor_name, effective_date },
    { onConflict: "room,weekday,time,effective_date" },
  );
  if (error) throw new Error(error.message);
}

export async function deleteRoomSlotTutorRule(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("room_slot_tutor_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
