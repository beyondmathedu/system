/**
 * Debug fee record L columns for a student/month.
 * Usage: npx tsx scripts/debug-fee-record-l-columns.mjs <studentId> <year> <month>
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

const [studentIdArg, yearStr, monthStr] = process.argv.slice(2);
if (!studentIdArg || !yearStr || !monthStr) {
  console.error("Usage: npx tsx scripts/debug-fee-record-l-columns.mjs <studentId> <year> <month>");
  process.exit(1);
}

const studentId = studentIdArg.padStart(5, "0");
const year = Number(yearStr);
const month = Number(monthStr);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

const {
  collectAttendedBillableLessonDatesForMonth,
  collectBillableLessonDatesForMonth,
  normalizeFeeLessonRecords,
  toYearLessonStateFromClient,
} = await import("../src/lib/feeRecordLessonDates.ts");
const { loadLessonScheduleRecordsBatchServer, loadLessonYearStatesBatchServer } = await import(
  "../src/lib/lessonDataServer.ts"
);
const {
  makeStudentInactiveDateCheckerFromPeriods,
  isStudentHiddenForFeeSheetMonthFromPeriods,
  buildStudentInactivePeriodsById,
} = await import("../src/lib/studentVisibility.ts");
const { inferGradeAtSheetEnd } = await import("../src/lib/studentFeePricingGrade.ts");

const MIN_L_COLUMN_COUNT = 9;

const [recordsMap, yearStatesMap] = await Promise.all([
  loadLessonScheduleRecordsBatchServer(supabase, [studentId]),
  loadLessonYearStatesBatchServer(supabase, [studentId], year),
]);

const records = normalizeFeeLessonRecords(recordsMap[studentId] ?? []);
const state = toYearLessonStateFromClient(yearStatesMap[studentId]);

const { data: visRows } = await supabase
  .from("student_visibility_periods")
  .select("student_id,start_date,end_date,note");
const periodsById = buildStudentInactivePeriodsById(visRows ?? []);
const { data: studentRow } = await supabase
  .from("students")
  .select("id,grade")
  .eq("id", studentId)
  .maybeSingle();
const vis = periodsById[studentId] ?? [];
const monthInactive = isStudentHiddenForFeeSheetMonthFromPeriods({
  periods: vis,
  studentId,
  grade: inferGradeAtSheetEnd(studentRow?.grade ?? "", year, month),
  sheetYear: year,
  sheetMonth: month,
});
const isDateInactive = makeStudentInactiveDateCheckerFromPeriods({
  studentId,
  grade: inferGradeAtSheetEnd(studentRow?.grade ?? "", year, month),
  year,
  periods: vis,
});

const common = {
  records,
  state,
  year,
  month1to12: month,
  legacyWeekdays: [],
  isDateInactive,
};
const attended = monthInactive ? [] : collectAttendedBillableLessonDatesForMonth(common);
const billable = monthInactive ? [] : collectBillableLessonDatesForMonth(common);

console.log(`Student ${studentId}, ${year}-${String(month).padStart(2, "0")}`);
console.log(`Month inactive: ${monthInactive}`);
console.log(`Schedule records: ${records.length}`);
console.log(`Attended (L columns): ${attended.length}`);
console.log(attended.join(", "));
console.log(`Billable slots: ${billable.length}`);
console.log(billable.join(", "));

// Global max for this month across all students (same as fee page logic)
const { data: allStudents } = await supabase.from("students").select("id,grade");
const allIds = (allStudents ?? []).map((r) => String(r.id));
const [allRecordsMap, allYearStatesMap] = await Promise.all([
  loadLessonScheduleRecordsBatchServer(supabase, allIds),
  loadLessonYearStatesBatchServer(supabase, allIds, year),
]);

let maxAttended = MIN_L_COLUMN_COUNT;
let maxStudent = "";
for (const st of allStudents ?? []) {
  const id = String(st.id);
  const periods = periodsById[id] ?? [];
  const inactiveMonth = isStudentHiddenForFeeSheetMonthFromPeriods({
    periods,
    studentId: id,
    grade: inferGradeAtSheetEnd(st.grade ?? "", year, month),
    sheetYear: year,
    sheetMonth: month,
  });
  if (inactiveMonth) continue;
  const dateInactive = makeStudentInactiveDateCheckerFromPeriods({
    studentId: id,
    grade: inferGradeAtSheetEnd(st.grade ?? "", year, month),
    year,
    periods,
  });
  const recs = normalizeFeeLessonRecords(allRecordsMap[id] ?? []);
  const stState = toYearLessonStateFromClient(allYearStatesMap[id]);
  const att = collectAttendedBillableLessonDatesForMonth({
    records: recs,
    state: stState,
    year,
    month1to12: month,
    isDateInactive: dateInactive,
  });
  if (att.length > maxAttended) {
    maxAttended = att.length;
    maxStudent = id;
  }
}
console.log(`\nGlobal max attended in month: ${Math.max(MIN_L_COLUMN_COUNT, maxAttended)} (student ${maxStudent || "n/a"})`);
