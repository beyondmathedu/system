import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  buildStudentBaseScheduleRows,
  buildStudentScheduleRows,
  type StudentScheduleMapperState,
} from "../src/lib/studentScheduleRowMapper";
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
  const hkToday = "2026-07-07";
  const month = 7;
  const { data: allRecs } = await sb.from("student_lesson_records").select("student_id, records");
  let editFails = 0;
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
    const baseSet = new Set(
      buildStudentBaseScheduleRows(records, mapperState, 2026, hkToday, { month }).map((r) => r.date),
    );
    const visible = buildStudentScheduleRows(records, mapperState, 2026, hkToday, { month });
    for (const r of visible.filter(
      (x) => x.rowKind === "reschedule" || x.rowKind === "cancelled_original",
    )) {
      const entry = (mapperState.rescheduleEntries as { id: string; fromDate: string }[]).find(
        (e) => e.id === r.rescheduleEntryId,
      );
      const from = entry?.fromDate;
      if (from && !baseSet.has(from)) {
        editFails++;
        console.log("edit-fromDate-miss", sid, r.date, "from", from, r.lessonType, r.rowKind);
      }
    }
  }
  console.log(`\neditFails (July filter): ${editFails}`);
}

void main();
