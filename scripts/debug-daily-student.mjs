/**
 * Debug why a student appears or not on Daily Timetable.
 * Usage: npx tsx scripts/debug-daily-student.mjs <studentId> <year> <month> <day>
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
  console.error("Usage: npx tsx scripts/debug-daily-student.mjs <studentId> <year> <month> <day>");
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
const { buildStudentInactivePeriodsById, isStudentInactiveOnDateFromPeriods, withAutoF6InactivePeriod } =
  await import("../src/lib/studentVisibility.ts");
const { inferGradeOnDate } = await import("../src/lib/inferStudentGrade.ts");
const { studentHasMakeupOrExtraOnDate, buildDayTimetableRowsForDate } = await import(
  "../src/lib/dayTimetableScheduleRows.ts"
);
const { loadLessonScheduleRecordsBatchServer, loadLessonYearStatesBatchServer } = await import(
  "../src/lib/lessonDataServer.ts"
);
const { fetchDayTimetablePayload } = await import("../src/lib/dayTimetableGrid.ts");

const { data: st } = await supabase
  .from("students")
  .select("id, name_zh, name_en, nickname_en, grade")
  .eq("id", studentId)
  .maybeSingle();
console.log("Student:", st);

const { data: visRows } = await supabase
  .from("student_visibility_periods")
  .select("student_id,start_date,end_date,note")
  .eq("student_id", studentId);
console.log("Visibility periods:", visRows);

const periodsById = buildStudentInactivePeriodsById(visRows ?? []);
const periods = withAutoF6InactivePeriod({
  periods: periodsById[studentId] ?? [],
  studentId,
  grade: inferGradeOnDate(st?.grade ?? "", dateIso),
  year,
});
const inactiveOnDate = isStudentInactiveOnDateFromPeriods({ periods, dateIso });
console.log(`Inactive on ${dateIso}:`, inactiveOnDate);

const allStudents = st ? [st] : [];
const active = filterActiveStudentsOnDate(allStudents, { [studentId]: periodsById[studentId] ?? [] }, year, dateIso);
console.log("Active on date:", active.length > 0);

const [recordsMap, yearStatesMap] = await Promise.all([
  loadLessonScheduleRecordsBatchServer(supabase, [studentId]),
  loadLessonYearStatesBatchServer(supabase, [studentId], year),
]);
const records = recordsMap[studentId] ?? [];
const state = yearStatesMap[studentId] ?? {
  attendance: {},
  hiddenDates: {},
  overrides: {},
  rescheduleEntries: [],
  extraEntries: [],
};

console.log("\nSchedule records:", records.length);
console.log("Reschedule entries:", JSON.stringify(state.rescheduleEntries ?? [], null, 2));
console.log("Extra entries:", JSON.stringify(state.extraEntries ?? [], null, 2));
console.log("Attendance keys (ticked):", Object.entries(state.attendance ?? {}).filter(([, v]) => v).map(([k]) => k));

const hasMakeup = studentHasMakeupOrExtraOnDate(state, dateIso);
console.log(`\nstudentHasMakeupOrExtraOnDate(${dateIso}):`, hasMakeup);

const dayRows = buildDayTimetableRowsForDate(records, state, dateIso, dateIso);
console.log("\nDay rows for date:");
for (const r of dayRows) {
  console.log(`  ${r.time} ${r.room} ${r.lessonType} tutor=${r.tutorDisplay}`);
}

const payload = await fetchDayTimetablePayload(year, month, day, {
  regularOnly: false,
  includeCancelledSlots: false,
  includeInactiveMakeupSlots: true,
});
let found = false;
for (const [key, cells] of Object.entries(payload.byTimeRoom)) {
  for (const c of cells) {
    if (c.studentId === studentId) {
      found = true;
      console.log(`\nIn Daily payload: ${key} -> ${c.name} ${c.lessonType} grade=${c.grade}`);
    }
  }
}
if (!found) {
  console.log("\nNOT found in Daily Timetable payload.");
  console.log("All students on that day:");
  const ids = new Set();
  for (const cells of Object.values(payload.byTimeRoom)) {
    for (const c of cells) ids.add(`${c.studentId} ${c.name} ${c.lessonType}`);
  }
  for (const line of [...ids].sort()) console.log(" ", line);
}
