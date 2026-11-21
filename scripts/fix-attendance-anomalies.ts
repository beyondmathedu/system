/**
 * Sanitize attendance maps (orphan / cancelled / bare-date / bogus regular:ex keys).
 *
 *   npx tsx scripts/fix-attendance-anomalies.ts --year=2026
 *   npx tsx scripts/fix-attendance-anomalies.ts --year=2026 --apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { sanitizeLessonAttendance } from "../src/lib/lessonScheduleVersions";
import {
  normalizeFeeLessonRecords,
  toYearLessonStateFromClient,
} from "../src/lib/feeRecordLessonDates";
import {
  buildStudentScheduleRows,
  type StudentScheduleMapperState,
} from "../src/lib/studentScheduleRowMapper";
import type { YearLessonRecord } from "../src/lib/yearScheduleCore";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in .env.local");
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey);
const apply = process.argv.includes("--apply");
const yearFilter = Number(
  process.argv.find((a) => a.startsWith("--year="))?.split("=")[1] ?? "2026",
);

function toYearLessonRecords(raw: unknown): YearLessonRecord[] {
  return normalizeFeeLessonRecords(raw).map((r) => ({
    ...r,
    createdAt: r.createdAt ?? Date.now(),
  }));
}

function toMapperState(raw: {
  hidden_dates?: unknown;
  overrides?: unknown;
  reschedule_entries?: unknown;
  extra_entries?: unknown;
}): StudentScheduleMapperState {
  const state = toYearLessonStateFromClient({
    attendance: {},
    hiddenDates: raw.hidden_dates,
    overrides: raw.overrides,
    rescheduleEntries: raw.reschedule_entries,
    extraEntries: raw.extra_entries,
  });
  return {
    hiddenDates: state.hiddenDates,
    overrides: state.overrides,
    rescheduleEntries: state.rescheduleEntries,
    extraEntries: state.extraEntries,
  };
}

async function main() {
  const [{ data: recordRows, error: recErr }, { data: stateRows, error: stateErr }] =
    await Promise.all([
      sb.from("student_lesson_records").select("student_id, records"),
      sb
        .from("student_lessons_year_state")
        .select(
          "student_id, year, attendance, hidden_dates, overrides, reschedule_entries, extra_entries",
        )
        .eq("year", yearFilter),
    ]);
  if (recErr) throw new Error(recErr.message);
  if (stateErr) throw new Error(stateErr.message);

  const recordsByStudent = new Map<string, YearLessonRecord[]>();
  for (const row of recordRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    if (!sid) continue;
    recordsByStudent.set(sid, toYearLessonRecords(row.records));
  }

  const report: Array<{
    studentId: string;
    changeCount: number;
    changes: string[];
  }> = [];
  let updated = 0;

  for (const row of stateRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    if (!sid) continue;

    const attendance = { ...((row.attendance ?? {}) as Record<string, boolean>) };
    const records = recordsByStudent.get(sid) ?? [];
    const mapperState = toMapperState(row);
    const scheduleRows = buildStudentScheduleRows(
      records,
      mapperState,
      yearFilter,
      `${yearFilter}-12-31`,
    );

    const liveKeys = new Set<string>();
    const regularSlots: Array<{ ruleId: string; dateIso: string }> = [];
    for (const r of scheduleRows) {
      liveKeys.add(r.attendanceKey);
      liveKeys.add(r.date);
      if (
        r.lessonType === "Regular" &&
        r.scheduleRuleId &&
        !String(r.scheduleRuleId).startsWith("ex:") &&
        !String(r.scheduleRuleId).startsWith("rs:")
      ) {
        liveKeys.add(`regular:${r.scheduleRuleId}:${r.date}`);
        regularSlots.push({ ruleId: r.scheduleRuleId, dateIso: r.date });
      }
    }

    const { attendance: next, changes } = sanitizeLessonAttendance(attendance, {
      knownRuleIds: records.map((r) => String(r.id ?? "").trim()).filter(Boolean),
      liveKeys,
      regularSlots,
      extraEntryIds: mapperState.extraEntries.map((e) => e.id),
      rescheduleEntryIds: mapperState.rescheduleEntries.map((e) => e.id),
    });

    if (changes.length === 0) continue;
    report.push({ studentId: sid, changeCount: changes.length, changes });

    if (apply) {
      const { error } = await sb
        .from("student_lessons_year_state")
        .update({
          attendance: next,
          updated_at: new Date().toISOString(),
        })
        .eq("student_id", sid)
        .eq("year", yearFilter);
      if (error) throw new Error(`${sid}: ${error.message}`);
      updated++;
    }
  }

  console.log(`=== Fix attendance anomalies (${apply ? "APPLY" : "dry-run"}) ===`);
  console.log(`Year: ${yearFilter}`);
  console.log(`Students needing cleanup: ${report.length}`);
  if (apply) console.log(`Updated rows: ${updated}`);

  const changeKinds = new Map<string, number>();
  for (const r of report) {
    for (const c of r.changes) {
      const kind = c.split(":")[0] ?? c;
      changeKinds.set(kind, (changeKinds.get(kind) ?? 0) + 1);
    }
  }
  console.log("\nChange kinds:");
  for (const [k, n] of [...changeKinds.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }

  console.log("\nFirst 20 students:");
  for (const r of report.slice(0, 20)) {
    console.log(`  ${r.studentId}: ${r.changeCount} changes`);
  }
  if (report.length > 20) console.log(`  ... +${report.length - 20} more`);

  const outPath = `fix-attendance-anomalies-${yearFilter}${apply ? "-applied" : "-dry"}.json`;
  writeFileSync(outPath, JSON.stringify({ year: yearFilter, apply, report }, null, 2));
  console.log(`\nWrote ${outPath}`);
  if (!apply) {
    console.log("Re-run with --apply to write changes to Supabase.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
