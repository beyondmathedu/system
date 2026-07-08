import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  buildStudentBaseScheduleRows,
  buildStudentScheduleRows,
  type StudentScheduleMapperState,
} from "../src/lib/studentScheduleRowMapper";
import { parseRegularLessonRowId } from "../src/lib/lessonScheduleHidden";
import type { YearLessonRecord } from "../src/lib/yearScheduleCore";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

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

function toMapperState(raw: {
  hidden_dates?: unknown;
  overrides?: unknown;
  reschedule_entries?: unknown;
  extra_entries?: unknown;
}): StudentScheduleMapperState {
  const hiddenDates =
    raw.hidden_dates && typeof raw.hidden_dates === "object"
      ? (raw.hidden_dates as Record<string, boolean>)
      : {};

  const overridesSource =
    raw.overrides && typeof raw.overrides === "object"
      ? (raw.overrides as Record<string, Record<string, unknown>>)
      : {};
  const overrides: StudentScheduleMapperState["overrides"] = {};
  for (const [date, value] of Object.entries(overridesSource)) {
    overrides[date] = {
      time: typeof value?.time === "string" ? value.time : undefined,
      room: typeof value?.room === "string" ? value.room : undefined,
      tutor: typeof value?.tutor === "string" ? value.tutor : undefined,
      lessonSummary: typeof value?.lessonSummary === "string" ? value.lessonSummary : undefined,
    };
  }

  const rescheduleEntries = Array.isArray(raw.reschedule_entries)
    ? raw.reschedule_entries.map((e) => {
        const entry = (e ?? {}) as Record<string, unknown>;
        return {
          id: String(entry.id ?? ""),
          fromDate: String(entry.fromDate ?? ""),
          toDate: String(entry.toDate ?? ""),
          time: String(entry.time ?? ""),
          room: String(entry.room ?? ""),
          pending: entry.pending === true ? true : undefined,
        };
      })
    : [];

  const extraEntries = Array.isArray(raw.extra_entries)
    ? raw.extra_entries.map((e) => {
        const entry = (e ?? {}) as Record<string, unknown>;
        return {
          id: String(entry.id ?? ""),
          date: String(entry.date ?? ""),
          time: String(entry.time ?? ""),
          room: String(entry.room ?? ""),
        };
      })
    : [];

  return { hiddenDates, overrides, rescheduleEntries, extraEntries };
}

async function main() {
const sid = process.argv[2] ?? "00002";
const { data: recRow } = await sb
  .from("student_lesson_records")
  .select("records")
  .eq("student_id", sid)
  .single();
const records = toYearLessonRecords(recRow?.records);
const { data: state } = await sb
  .from("student_lessons_year_state")
  .select("*")
  .eq("student_id", sid)
  .eq("year", 2026)
  .single();

const mapperState = toMapperState(state ?? {});

const hkToday = "2026-07-07";
for (const month of [7, 6, 0]) {
  const opts = month ? { month } : undefined;
  const base = buildStudentBaseScheduleRows(records, mapperState, 2026, hkToday, opts);
  const rows = buildStudentScheduleRows(records, mapperState, 2026, hkToday, opts);
  console.log(`\n=== month filter: ${month || "all"} ===`);
  console.log("base dates:", base.map((r) => r.date));
  console.log(
    "visible:",
    rows.map((r) => `${r.date} ${r.lessonType} ${r.rowKind}`),
  );
}

const julyBase = buildStudentBaseScheduleRows(records, mapperState, 2026, hkToday, { month: 7 });
const fullBase = buildStudentBaseScheduleRows(records, mapperState, 2026, hkToday, undefined);
for (const e of mapperState.rescheduleEntries as { fromDate: string; pending?: boolean }[]) {
  console.log(
    `fromDate ${e.fromDate}: julyBase=${julyBase.some((r) => r.date === e.fromDate)} fullBase=${fullBase.some((r) => r.date === e.fromDate)} pending=${Boolean(e.pending)}`,
  );
}

const julyRows = buildStudentScheduleRows(records, mapperState, 2026, hkToday, { month: 7 });
const julyBaseMap = new Map(julyRows.map((r) => [r.date, r]));
const julyBaseDates = buildStudentBaseScheduleRows(records, mapperState, 2026, hkToday, { month: 7 }).map(
  (r) => r.date,
);
const julyBaseSet = new Set(julyBaseDates);

console.log("\n=== July validation simulation ===");
for (const row of julyRows.filter((r) => r.lessonType === "Regular" && r.rowKind === "normal")) {
  const parsed = parseRegularLessonRowId(row.rowId);
  const inBase = julyBaseSet.has(row.date);
  if (!parsed || !inBase) {
    console.log("PROBLEM", row.date, row.rowId, { parsed: Boolean(parsed), inBase });
  }
}

const regular = julyRows.find((r) => r.lessonType === "Regular");
if (regular) {
  console.log("\nJuly regular rowId:", regular.rowId);
  console.log("parse:", parseRegularLessonRowId(regular.rowId));
}
}

async function scanAll() {
  const hkToday = "2026-07-07";
  const month = 7;
  const { data: allRecs } = await sb.from("student_lesson_records").select("student_id, records");
  let parseFails = 0;
  let baseMiss = 0;
  let checked = 0;
  for (const row of allRecs ?? []) {
    const sid = row.student_id as string;
    const records = toYearLessonRecords(row.records);
    if (!records.length) continue;
    const { data: state } = await sb
      .from("student_lessons_year_state")
      .select("hidden_dates, overrides, reschedule_entries, extra_entries")
      .eq("student_id", sid)
      .eq("year", 2026)
      .maybeSingle();
    const mapperState = toMapperState(state ?? {});
    const opts = { month };
    const baseSet = new Set(
      buildStudentBaseScheduleRows(records, mapperState, 2026, hkToday, opts).map((r) => r.date),
    );
    const visible = buildStudentScheduleRows(records, mapperState, 2026, hkToday, opts);
    for (const r of visible.filter((x) => x.lessonType === "Regular" && x.rowKind === "normal")) {
      checked++;
      if (!parseRegularLessonRowId(r.rowId)) {
        parseFails++;
        console.log("parse fail", sid, r.date, r.rowId);
      }
      if (!baseSet.has(r.date)) {
        baseMiss++;
        console.log("base miss", sid, r.date, r.rowId);
      }
    }
  }
  console.log(`\nScan month=${month}: checked=${checked} parseFails=${parseFails} baseMiss=${baseMiss}`);
}

if (process.argv.includes("--all")) {
  void scanAll();
} else {
  void main();
}
