/**
 * Debug why a student appears or not on Daily Timetable for a date.
 * Usage: npx tsx scripts/debug-daily-timetable-student.mjs <studentId> <year> <month> <day>
 */
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

const [studentIdArg, yearStr, monthStr, dayStr] = process.argv.slice(2);
if (!studentIdArg || !yearStr || !monthStr || !dayStr) {
  console.error("Usage: npx tsx scripts/debug-daily-timetable-student.mjs <studentId> <year> <month> <day>");
  process.exit(1);
}

const studentId = studentIdArg.padStart(5, "0");
const year = Number(yearStr);
const month = Number(monthStr);
const day = Number(dayStr);
const dateIso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { filterActiveStudentsOnDate } = await import("../src/lib/activeStudentIds.ts");
const { buildStudentInactivePeriodsById, isTemporarilyInactiveOnDateFromPeriods, withAutoF6InactivePeriod } =
  await import("../src/lib/studentVisibility.ts");
const { inferGradeOnDate } = await import("../src/lib/inferStudentGrade.ts");
const { studentHasMakeupOrExtraOnDate, buildDayTimetableRowsForDate } = await import(
  "../src/lib/dayTimetableScheduleRows.ts",
);
const { loadLessonScheduleRecordsBatchServer, loadLessonYearStatesBatchServer } = await import(
  "../src/lib/lessonDataServer.ts",
);
const { normalizeLessonRecords } = await import("../src/lib/yearScheduleData.server.ts");
const { toYearLessonStateFromClient } = await import("../src/lib/feeRecordLessonDates.ts");

const { data: student } = await supabase
  .from("students")
  .select("id,name_zh,name_en,nickname_en,grade")
  .eq("id", studentId)
  .maybeSingle();
console.log("Student:", student);

const { data: visRows } = await supabase
  .from("student_visibility_periods")
  .select("student_id,start_date,end_date,note")
  .eq("student_id", studentId);
console.log("Visibility periods:", visRows);

const periodsById = buildStudentInactivePeriodsById(visRows ?? []);
const periods = withAutoF6InactivePeriod({
  periods: periodsById[studentId] ?? [],
  studentId,
  grade: inferGradeOnDate(student?.grade ?? "", dateIso),
  year,
});
console.log("Merged periods:", periods);
console.log("Inactive on date:", isTemporarilyInactiveOnDateFromPeriods({ periods, dateIso }));

const { data: allStudents } = await supabase.from("students").select("id,grade");
const allPeriods = buildStudentInactivePeriodsById(
  (
    await supabase.from("student_visibility_periods").select("student_id,start_date,end_date,note")
  ).data ?? [],
);
const active = filterActiveStudentsOnDate(allStudents ?? [], allPeriods, year, dateIso);
console.log("Active on date:", active.some((s) => String(s.id) === studentId));

const [recordsMap, yearStatesMap] = await Promise.all([
  loadLessonScheduleRecordsBatchServer(supabase, [studentId]),
  loadLessonYearStatesBatchServer(supabase, [studentId], year),
]);
const records = normalizeLessonRecords(recordsMap[studentId] ?? []);
const state = toYearLessonStateFromClient(yearStatesMap[studentId]);
console.log("Schedule records:", records.length);
console.log("Reschedule entries:", JSON.stringify(state.rescheduleEntries ?? [], null, 2));
console.log("Extra entries:", JSON.stringify(state.extraEntries ?? [], null, 2));
console.log("Attendance keys (true):", Object.entries(state.attendance ?? {}).filter(([, v]) => v).map(([k]) => k));

console.log("Has makeup/extra on date:", studentHasMakeupOrExtraOnDate(state, dateIso));
const dayRows = buildDayTimetableRowsForDate(records, state, dateIso, dateIso);
console.log(
  "Day rows:",
  dayRows.map((r) => `${r.time} ${r.room} ${r.lessonType}`),
);

const { data: students } = await supabase
  .from("students")
  .select("id,name_zh,name_en,nickname_en,grade")
  .or("name_zh.ilike.%徐洛悠%,name_zh.ilike.%朱翠頤%");
console.log("Related students:", students);

const { filterStudentsWithAnyActivityInYear } = await import("../src/lib/activeStudentIds.ts");
const { data: allStudents2 } = await supabase.from("students").select("id,grade");
const { data: allVis } = await supabase
  .from("student_visibility_periods")
  .select("student_id,start_date,end_date,note");
const allPeriods2 = buildStudentInactivePeriodsById(allVis ?? []);
const activeYear = filterStudentsWithAnyActivityInYear(allStudents2 ?? [], allPeriods2, year);
console.log("In year activity batch:", activeYear.some((s) => String(s.id) === studentId));
const [batchRecords, batchStates] = await Promise.all([
  loadLessonScheduleRecordsBatchServer(
    supabase,
    activeYear.map((s) => String(s.id)),
  ),
  loadLessonYearStatesBatchServer(
    supabase,
    activeYear.map((s) => String(s.id)),
    year,
  ),
]);
console.log("In batch records:", studentId in batchRecords);
console.log("In batch state:", studentId in batchStates);
const batchState = toYearLessonStateFromClient(batchStates[studentId]);
console.log("Batch state makeup on date:", studentHasMakeupOrExtraOnDate(batchState, dateIso));

