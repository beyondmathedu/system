/**
 * Audit tutor display: room_slot_tutor_rules vs overrides vs expanded schedule rows.
 * Run: npx tsx scripts/audit-tutor-consistency.ts
 */
import { createClient } from "@supabase/supabase-js";
import { buildYearScheduleRowsForMonth } from "../src/lib/yearScheduleCore";
import {
  loadRoomSlotTutorRulesServer,
  resolveRoomSlotTutorForLessonRow,
} from "../src/lib/roomSlotTutorRules";

const YEAR = 2026;
const MONTHS = [5, 6, 7];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in env");
    process.exit(1);
  }

  const sb = createClient(url, key);
  const rules = await loadRoomSlotTutorRulesServer(sb);
  const [{ data: states }, { data: recRows }] = await Promise.all([
    sb.from("student_lessons_year_state").select("student_id, overrides").eq("year", YEAR),
    sb.from("student_lesson_records").select("student_id, records"),
  ]);

  const recMap = new Map((recRows ?? []).map((r) => [String(r.student_id), r.records ?? []]));

  let missingSlotDisplay = 0;
  let overrideConflicts = 0;
  const conflictSamples: string[] = [];
  const missingSamples: string[] = [];

  for (const st of states ?? []) {
    const sid = String(st.student_id);
    const overrides = (st.overrides ?? {}) as Record<string, { tutor?: string }>;
    const records = (recMap.get(sid) ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      effectiveDate: String(r.effectiveDate ?? "2026-05-01"),
      weekday: String(r.weekday ?? ""),
      time: String(r.time ?? ""),
      room: String(r.room ?? ""),
      createdAt: Number(r.createdAt) > 0 ? Number(r.createdAt) : 1,
    }));

    const state = {
      attendance: {},
      hiddenDates: {},
      overrides,
      rescheduleEntries: [],
      extraEntries: [],
    };

    for (const month of MONTHS) {
      const rows = buildYearScheduleRowsForMonth(records, state, YEAR, month, {
        roomSlotTutorRules: rules,
      });
      for (const row of rows) {
        if (row.lessonType === "取消") continue;
        const slotTutor =
          resolveRoomSlotTutorForLessonRow(rules, {
            room: row.room,
            time: row.time,
            dateIso: row.date,
          }) ?? "";
        const overrideTutor = String(overrides[row.date]?.tutor ?? "").trim();
        const display = row.tutorDisplay.trim();

        if (overrideTutor && slotTutor && overrideTutor !== slotTutor) {
          overrideConflicts++;
          if (conflictSamples.length < 15) {
            conflictSamples.push(
              `${sid} ${row.date} ${row.room} ${row.time} override=${overrideTutor} slot=${slotTutor}`,
            );
          }
        }

        if (!overrideTutor && slotTutor && display !== slotTutor) {
          missingSlotDisplay++;
          if (missingSamples.length < 10) {
            missingSamples.push(
              `${sid} ${row.date} ${row.room} ${row.time} expected=${slotTutor} got=${display || "—"}`,
            );
          }
        }
      }
    }
  }

  console.log(`Room slot rules loaded: ${rules.length}`);
  console.log(`Override conflicts (override ≠ slot rule): ${overrideConflicts}`);
  console.log(`Display gaps (no override, slot rule not shown): ${missingSlotDisplay}`);
  if (conflictSamples.length) {
    console.log("\nOverride conflict samples:");
    for (const line of conflictSamples) console.log(`  ${line}`);
  }
  if (missingSamples.length) {
    console.log("\nDisplay gap samples:");
    for (const line of missingSamples) console.log(`  ${line}`);
  }
}

void main();
