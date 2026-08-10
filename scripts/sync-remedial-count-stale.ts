import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { normalizeFeeLessonRecords, toYearLessonStateFromClient } from "../src/lib/feeRecordLessonDates";
import { getUpcomingUntickedDates } from "../src/lib/lesson2026Summary";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const year = 2026;
  const nowMs = Date.parse("2026-08-10T12:00:00+08:00");
  const targets = ["00014", "00305", "00033"];

  for (const sid of targets) {
    const [{ data: rec }, { data: stateRow }, { data: metrics }] = await Promise.all([
      sb.from("student_lesson_records").select("records").eq("student_id", sid).maybeSingle(),
      sb
        .from("student_lessons_year_state")
        .select("*")
        .eq("student_id", sid)
        .eq("year", year)
        .maybeSingle(),
      sb
        .from("student_lessons_year_metrics")
        .select("remedial_count, current_month_absent_count")
        .eq("student_id", sid)
        .eq("year", year)
        .maybeSingle(),
    ]);
    const records = normalizeFeeLessonRecords(rec?.records);
    const state = toYearLessonStateFromClient({
      attendance: stateRow?.attendance ?? {},
      hiddenDates: stateRow?.hidden_dates ?? {},
      overrides: stateRow?.overrides ?? {},
      rescheduleEntries: stateRow?.reschedule_entries ?? [],
      extraEntries: stateRow?.extra_entries ?? [],
    });
    const live = getUpcomingUntickedDates(records, state, nowMs, year).length;
    const prev = Number(metrics?.remedial_count ?? 0) || 0;
    const absent = Number(metrics?.current_month_absent_count ?? 0) || 0;
    const { error } = await sb.from("student_lessons_year_metrics").upsert(
      {
        student_id: sid,
        year,
        remedial_count: live,
        current_month_absent_count: absent,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,year" },
    );
    if (error) throw error;
    console.log(`${sid}: remedial_count ${prev} -> ${live}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
