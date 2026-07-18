/**
 * Remove per-date overrides.tutor when it conflicts with room_slot_tutor_rules.
 * Keeps other override fields (time, room, lessonSummary) intact.
 *
 * Run: npx tsx scripts/cleanup-conflicting-tutor-overrides.ts
 * Dry run: npx tsx scripts/cleanup-conflicting-tutor-overrides.ts --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { buildYearScheduleRowsForMonth } from "../src/lib/yearScheduleCore";
import {
  loadRoomSlotTutorRulesServer,
  resolveRoomSlotTutorForLessonRow,
} from "../src/lib/roomSlotTutorRules";

const YEAR = 2026;
const MONTHS = [5, 6, 7, 8, 9, 10, 11, 12];

type OverrideEntry = Record<string, unknown>;

function stripTutorFromOverrides(
  overrides: Record<string, OverrideEntry>,
  dateKeys: Set<string>,
): { next: Record<string, OverrideEntry>; removed: number } {
  const next: Record<string, OverrideEntry> = { ...overrides };
  let removed = 0;

  for (const dateIso of dateKeys) {
    const entry = next[dateIso];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (!("tutor" in entry)) continue;

    removed++;
    const row = { ...entry };
    delete row.tutor;
    if (Object.keys(row).length === 0) {
      delete next[dateIso];
    } else {
      next[dateIso] = row;
    }
  }

  return { next, removed };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
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

  const updates: Array<{
    studentId: string;
    conflictDates: Set<string>;
    samples: string[];
    nextOverrides: Record<string, OverrideEntry>;
    removedCount: number;
  }> = [];

  for (const st of states ?? []) {
    const sid = String(st.student_id);
    const overrides = (st.overrides ?? {}) as Record<string, OverrideEntry>;
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

    const conflictDates = new Set<string>();
    const samples: string[] = [];

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
        if (overrideTutor && slotTutor && overrideTutor !== slotTutor) {
          conflictDates.add(row.date);
          if (samples.length < 5) {
            samples.push(
              `${row.date} ${row.room} ${row.time}: ${overrideTutor} → ${slotTutor}`,
            );
          }
        }
      }
    }

    if (conflictDates.size === 0) continue;

    const { next, removed } = stripTutorFromOverrides(overrides, conflictDates);
    updates.push({
      studentId: sid,
      conflictDates,
      samples,
      nextOverrides: next,
      removedCount: removed,
    });
  }

  const totalRemoved = updates.reduce((sum, u) => sum + u.removedCount, 0);
  console.log(`${dryRun ? "[DRY RUN] " : ""}Students to update: ${updates.length}`);
  console.log(`${dryRun ? "[DRY RUN] " : ""}Conflicting tutor overrides to remove: ${totalRemoved}`);

  for (const u of updates.slice(0, 20)) {
    console.log(`\n${u.studentId}: ${u.removedCount} date(s)`);
    for (const s of u.samples) console.log(`  ${s}`);
  }
  if (updates.length > 20) {
    console.log(`\n... and ${updates.length - 20} more students`);
  }

  if (dryRun) return;

  let ok = 0;
  let fail = 0;
  for (const u of updates) {
    const { error } = await sb
      .from("student_lessons_year_state")
      .upsert(
        {
          student_id: u.studentId,
          year: YEAR,
          overrides: u.nextOverrides,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,year" },
      );
    if (error) {
      console.error(`Failed ${u.studentId}: ${error.message}`);
      fail++;
    } else {
      ok++;
    }
  }

  console.log(`\nDone. Updated ${ok} students, ${fail} failed.`);
}

void main();
