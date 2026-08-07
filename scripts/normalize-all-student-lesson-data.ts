/**
 * Batch-fix all students:
 * 1) Colliding schedule rule ids (May 2026 tutor patch legacy)
 * 2) Legacy whole-day reschedule rows on multi-lesson dates
 * 3) Backfill from-slot fields on single-lesson legacy reschedule rows
 *
 * Dry run (default):
 *   npx tsx scripts/normalize-all-student-lesson-data.ts
 *
 * Write to Supabase:
 *   npx tsx scripts/normalize-all-student-lesson-data.ts --apply
 *
 * Optional:
 *   --year=2026
 *   --student=00255
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { canonicalScheduleRoomLabel } from "../src/lib/dayTimetableShared";
import { repairCollidingScheduleRuleIds } from "../src/lib/lessonScheduleVersions";
import { normalizeRescheduleEntriesForSchedule } from "../src/lib/rescheduleEntryNormalize";
import type { YearLessonRecord, YearLessonRescheduleEntry } from "../src/lib/yearScheduleCore";

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
const studentFilter = process.argv.find((a) => a.startsWith("--student="))?.split("=")[1]?.trim();

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeScheduleRecords(raw: unknown): YearLessonRecord[] {
  if (!Array.isArray(raw)) return [];
  type RepairableRecord = YearLessonRecord & { effectiveDate: string };
  const mapped: RepairableRecord[] = toYearLessonRecords(raw).map((row) => {
    const room = canonicalScheduleRoomLabel(String(row.room ?? ""));
    return {
      ...row,
      room: room || row.room,
      effectiveDate:
        row.effectiveDate ??
        new Date(row.createdAt).toISOString().slice(0, 10),
    };
  });
  return repairCollidingScheduleRuleIds(mapped).rules;
}

function toYearLessonRecords(raw: unknown): YearLessonRecord[] {
  return ((raw ?? []) as Record<string, unknown>[]).map((r) => ({
    id: typeof r.id === "string" ? r.id : undefined,
    effectiveDate: typeof r.effectiveDate === "string" ? r.effectiveDate : undefined,
    weekday: String(r.weekday ?? ""),
    time: String(r.time ?? ""),
    room: String(r.room ?? ""),
    tutor: typeof r.tutor === "string" ? r.tutor : undefined,
    lessonSummary: typeof r.lessonSummary === "string" ? r.lessonSummary : undefined,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
  }));
}

function toRescheduleEntries(raw: unknown): YearLessonRescheduleEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    const entry = (e ?? {}) as Record<string, unknown>;
    return {
      id: String(entry.id ?? ""),
      fromDate: String(entry.fromDate ?? ""),
      toDate: String(entry.toDate ?? ""),
      time: String(entry.time ?? ""),
      room: String(entry.room ?? ""),
      pending: entry.pending === true ? true : undefined,
      ...(typeof entry.fromScheduleRuleId === "string"
        ? { fromScheduleRuleId: entry.fromScheduleRuleId }
        : {}),
      ...(typeof entry.fromTime === "string" ? { fromTime: entry.fromTime } : {}),
      ...(typeof entry.fromRoom === "string" ? { fromRoom: entry.fromRoom } : {}),
    };
  });
}

function toOverrides(raw: unknown): Record<string, { time?: string; room?: string; tutor?: string; lessonSummary?: string }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { time?: string; room?: string; tutor?: string; lessonSummary?: string }> = {};
  for (const [date, value] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    out[date] = {
      time: typeof value?.time === "string" ? value.time : undefined,
      room: typeof value?.room === "string" ? value.room : undefined,
      tutor: typeof value?.tutor === "string" ? value.tutor : undefined,
      lessonSummary: typeof value?.lessonSummary === "string" ? value.lessonSummary : undefined,
    };
  }
  return out;
}

async function main() {
  console.log(
    apply
      ? "=== APPLY mode — writing fixes to Supabase ==="
      : "=== DRY RUN — pass --apply to write ===",
  );
  console.log(`Year filter: ${yearFilter}` + (studentFilter ? `, student: ${studentFilter}` : ""));

  let recordsQuery = sb.from("student_lesson_records").select("student_id, records");
  if (studentFilter) recordsQuery = recordsQuery.eq("student_id", studentFilter);

  let stateQuery = sb
    .from("student_lessons_year_state")
    .select("student_id, year, hidden_dates, overrides, reschedule_entries")
    .eq("year", yearFilter);
  if (studentFilter) stateQuery = stateQuery.eq("student_id", studentFilter);

  const [{ data: recordRows, error: recErr }, { data: stateRows, error: stateErr }] = await Promise.all([
    recordsQuery,
    stateQuery,
  ]);

  if (recErr) throw new Error(recErr.message);
  if (stateErr) throw new Error(stateErr.message);

  const recordsByStudent = new Map<string, YearLessonRecord[]>();
  for (const row of recordRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    if (!sid) continue;
    recordsByStudent.set(sid, toYearLessonRecords(row.records));
  }

  let scheduleFixed = 0;
  let rescheduleFixed = 0;
  let legacyDropped = 0;
  let slotBackfilled = 0;

  for (const row of recordRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    if (!sid) continue;

    const rawRecords = row.records;
    const normalizedRecords = normalizeScheduleRecords(rawRecords);
    const rawParsed = toYearLessonRecords(rawRecords);
    if (stableJson(normalizedRecords) !== stableJson(rawParsed)) {
      scheduleFixed++;
      console.log(`[schedule] ${sid}: repaired ${rawParsed.length} rules`);
      if (apply) {
        const { error } = await sb.from("student_lesson_records").upsert({
          student_id: sid,
          records: normalizedRecords,
          updated_at: new Date().toISOString(),
        });
        if (error) throw new Error(`${sid} schedule upsert: ${error.message}`);
      }
    }
    recordsByStudent.set(sid, normalizedRecords.length ? normalizedRecords : rawParsed);
  }

  for (const row of stateRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    const year = Number(row.year);
    if (!sid || !Number.isFinite(year)) continue;

    const records = recordsByStudent.get(sid) ?? [];
    const hiddenDates =
      row.hidden_dates && typeof row.hidden_dates === "object"
        ? (row.hidden_dates as Record<string, boolean>)
        : {};
    const overrides = toOverrides(row.overrides);
    const before = toRescheduleEntries(row.reschedule_entries);
    const after = normalizeRescheduleEntriesForSchedule(
      before,
      records,
      hiddenDates,
      overrides,
      year,
    );

    if (stableJson(before) === stableJson(after)) continue;

    rescheduleFixed++;
    const removed = before.length - after.length;
    if (removed > 0) legacyDropped += removed;
    const backfilled = after.filter((e) => {
      const prev = before.find((b) => b.id === e.id);
      return (
        prev &&
        !prev.fromScheduleRuleId &&
        !prev.fromTime &&
        !prev.fromRoom &&
        Boolean(e.fromScheduleRuleId || e.fromTime || e.fromRoom)
      );
    }).length;
    slotBackfilled += backfilled;

    console.log(
      `[reschedule] ${sid} y${year}: ${before.length} → ${after.length}` +
        (removed ? ` (removed ${removed} orphan legacy)` : "") +
        (backfilled ? ` (backfilled ${backfilled})` : ""),
    );

    if (apply) {
      const { error } = await sb
        .from("student_lessons_year_state")
        .update({
          reschedule_entries: after,
          updated_at: new Date().toISOString(),
        })
        .eq("student_id", sid)
        .eq("year", year);
      if (error) throw new Error(`${sid} year state update: ${error.message}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Students scanned (records): ${recordRows?.length ?? 0}`);
  console.log(`Students scanned (year state): ${stateRows?.length ?? 0}`);
  console.log(`Schedule records fixed: ${scheduleFixed}`);
  console.log(`Reschedule lists fixed: ${rescheduleFixed}`);
  console.log(`Legacy orphan rows removed: ${legacyDropped}`);
  console.log(`Legacy rows backfilled with slot: ${slotBackfilled}`);
  if (!apply && (scheduleFixed > 0 || rescheduleFixed > 0)) {
    console.log("\nRe-run with --apply to persist.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
