import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq <= 0) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (!process.env[k]) process.env[k] = v;
      }
    } catch {
      /* optional */
    }
  }
}

loadEnv();

const studentId = "00160";
const year = 2026;
const dateIso = "2026-08-29";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { filterStudentsWithAnyActivityInYear } = await import("../src/lib/activeStudentIds.ts");
const { buildStudentInactivePeriodsById } = await import("../src/lib/studentVisibility.ts");
const { loadLessonScheduleRecordsBatchServer, loadLessonYearStatesBatchServer } = await import(
  "../src/lib/lessonDataServer.ts",
);
const { normalizeLessonRecords } = await import("../src/lib/yearScheduleData.server.ts");
const { studentHasMakeupOrExtraOnDate } = await import("../src/lib/dayTimetableScheduleRows.ts");
const { toYearLessonStateFromClient } = await import("../src/lib/feeRecordLessonDates.ts");

const { data: allStudents } = await supabase.from("students").select("id,grade");
const { data: allVis } = await supabase
  .from("student_visibility_periods")
  .select("student_id,start_date,end_date,note");
const allPeriods = buildStudentInactivePeriodsById(allVis ?? []);
const activeYear = filterStudentsWithAnyActivityInYear(allStudents ?? [], allPeriods, year);
const ids = activeYear.map((s) => String(s.id));
console.log("Year batch size:", ids.length, "includes 00160:", ids.includes(studentId));

const [recordsMap, stateById] = await Promise.all([
  loadLessonScheduleRecordsBatchServer(supabase, ids),
  loadLessonYearStatesBatchServer(supabase, ids, year),
]);
console.log("stateById has 00160:", studentId in stateById);
const state = toYearLessonStateFromClient(stateById[studentId]);
console.log("makeup on date from batch state:", studentHasMakeupOrExtraOnDate(state, dateIso));
console.log(
  "reschedule 8/29:",
  (state.rescheduleEntries ?? []).filter((e) => e.toDate === dateIso),
);
