/**
 * Time heavy-page data loaders outside Next (no unstable_cache).
 *   npx tsx scripts/bench-heavy-pages.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const supabase = createClient(url, key);

async function time(label, fn) {
  const t0 = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - t0);
  console.log(`${label.padEnd(48)} ${String(ms).padStart(6)} ms`);
  return { ms, result };
}

const { loadFeeRecordBootstrap } = await import("../src/lib/lessonDataServer.ts");
const { listStudentsForPage } = await import("../src/lib/studentsListServer.ts");
const { getSupabaseAdmin } = await import("../src/lib/supabaseAdmin.ts");
const {
  loadLessonScheduleRecordsBatchServer,
  loadLessonYearStatesBatchServer,
  loadLessonMetricsBatchServer,
} = await import("../src/lib/lessonDataServer.ts");

console.log("=== Heavy page data loaders ===\n");

const students = await time("Students list (first 80 active)", () =>
  listStudentsForPage(getSupabaseAdmin(), { offset: 0, limit: 80, status: "active" }),
);

const fee = await time("Fee Record bootstrap FULL (2026-11)", () =>
  loadFeeRecordBootstrap(supabase, { sheetYear: 2026, sheetMonth: 11 }),
);

const ids = (fee.result?.students ?? []).map((s) => s.id);
console.log(`\n  students in fee bootstrap: ${ids.length}`);
console.log("\n--- Fee bootstrap pieces (same DB, sequential for clarity) ---\n");

await time("  students table select", async () => {
  const { error } = await supabase
    .from("students")
    .select("id, name_zh, name_en, nickname_en, grade, student_phone, created_at")
    .order("id");
  if (error) throw error;
});

await time("  visibility periods (chunked)", async () => {
  const { fetchRowsInChunks } = await import("../src/lib/supabaseBatchIn.ts");
  return fetchRowsInChunks({
    ids,
    concurrency: 8,
    query: (chunk) =>
      supabase
        .from("student_visibility_periods")
        .select("student_id, start_date, end_date, note")
        .in("student_id", chunk),
  });
});

await time("  lesson metrics batch", () => loadLessonMetricsBatchServer(supabase, ids, 2026));
await time("  schedule records batch", () => loadLessonScheduleRecordsBatchServer(supabase, ids));
await time("  year states batch", () => loadLessonYearStatesBatchServer(supabase, ids, 2026));

await time("  monthly fee rows May–Nov", async () => {
  const { loadStudentMonthlyFeeRecordsInMonthRangeServer } = await import(
    "../src/lib/lessonDataServer.ts"
  );
  return loadStudentMonthlyFeeRecordsInMonthRangeServer(supabase, {
    studentIds: ids,
    year: 2026,
    monthFrom: 5,
    monthTo: 11,
  });
});

console.log("\n--- Daily Timetable-ish day expand inputs ---\n");
const sampleIds = ids.slice(0, 50);
await time("  50 students year-state + records", async () => {
  const [records, states] = await Promise.all([
    loadLessonScheduleRecordsBatchServer(supabase, sampleIds),
    loadLessonYearStatesBatchServer(supabase, sampleIds, 2026),
  ]);
  return { records: Object.keys(records).length, states: Object.keys(states).length };
});

console.log("\nDone.");
console.log(`Students list rows: ${students.result?.rows?.length ?? "?"}`);
