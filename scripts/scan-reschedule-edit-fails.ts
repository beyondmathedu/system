import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { buildStudentBaseScheduleRows, buildStudentScheduleRows } from "../src/lib/studentScheduleRowMapper";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function main() {
  const hkToday = "2026-07-07";
  const month = 7;
  const { data: allRecs } = await sb.from("student_lesson_records").select("student_id, records");
  let editFails = 0;
  for (const row of allRecs ?? []) {
    const sid = row.student_id as string;
    const records = ((row.records ?? []) as Record<string, unknown>[]).map((r) => ({
      ...r,
      createdAt: (r.createdAt as number) ?? Date.now(),
    }));
    if (!records.length) continue;
    const { data: state } = await sb
      .from("student_lessons_year_state")
      .select("hidden_dates, overrides, reschedule_entries, extra_entries")
      .eq("student_id", sid)
      .eq("year", 2026)
      .maybeSingle();
    const mapperState = {
      hiddenDates: (state?.hidden_dates as Record<string, boolean>) ?? {},
      overrides: (state?.overrides as Record<string, unknown>) ?? {},
      rescheduleEntries: (state?.reschedule_entries as unknown[]) ?? [],
      extraEntries: (state?.extra_entries as unknown[]) ?? [],
    };
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
