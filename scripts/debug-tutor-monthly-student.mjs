/**
 * Debug why a student appears or not on tutor monthly record.
 * Usage: npx tsx scripts/debug-tutor-monthly-student.mjs <studentId> <tutorId> <year> <month>
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

const [studentId, tutorId, yearStr, monthStr] = process.argv.slice(2);
if (!studentId || !tutorId || !yearStr || !monthStr) {
  console.error(
    "Usage: npx tsx scripts/debug-tutor-monthly-student.mjs <studentId> <tutorId> <year> <month>",
  );
  process.exit(1);
}

const year = Number(yearStr);
const month = Number(monthStr);

const { fetchTutorMonthLessonRows } = await import("../src/lib/roomScheduleAggregate.ts");
const { buildYearScheduleRowsForMonth } = await import("../src/lib/yearScheduleCore.ts");
const { normalizeLessonRecords } = await import("../src/lib/yearScheduleData.server.ts");
const { isScheduleAttendanceMarked } = await import("../src/lib/lessonScheduleVersions.ts");
const { loadRoomSlotTutorRulesServer } = await import("../src/lib/roomSlotTutorRules.ts");

const { hasTutorNameCandidate } = await import("../src/lib/tutorMonthCandidate.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: tutor } = await sb.from("tutors").select("*").eq("id", tutorId).maybeSingle();
const matchNames = [
  tutor?.name,
  tutor?.name_zh,
  tutor?.name_en,
  tutor?.nickname_en,
].filter(Boolean);

const [{ data: stateRow }, { data: recRow }, { data: student }] = await Promise.all([
  sb.from("student_lessons_year_state").select("*").eq("student_id", studentId).eq("year", year).maybeSingle(),
  sb.from("student_lesson_records").select("records").eq("student_id", studentId).maybeSingle(),
  sb.from("students").select("id,name_zh,name_en").eq("id", studentId).maybeSingle(),
]);

const records = normalizeLessonRecords(recRow?.records);
const state = {
  attendance: stateRow?.attendance ?? {},
  hiddenDates: stateRow?.hidden_dates ?? {},
  overrides: stateRow?.overrides ?? {},
  rescheduleEntries: stateRow?.reschedule_entries ?? [],
  extraEntries: stateRow?.extra_entries ?? [],
};
const rules = await loadRoomSlotTutorRulesServer(sb);
const nameSet = new Set(matchNames);
console.log("hasTutorNameCandidate:", hasTutorNameCandidate(records, state, nameSet, rules));
const monthRows = buildYearScheduleRowsForMonth(records, state, year, month, {
  roomSlotTutorRules: rules,
});

console.log("Student:", student);
console.log("Tutor:", tutorId, "matchNames:", matchNames);
console.log(`\nExpanded rows for ${year}-${String(month).padStart(2, "0")}:`);
for (const r of monthRows) {
  const attended = isScheduleAttendanceMarked(state.attendance, {
    attendanceKey: r.attendanceKey,
    dateIso: r.date,
    lessonType: r.lessonType,
    scheduleRuleId: r.scheduleRuleId,
  });
  const tutorMatch = matchNames.includes(r.tutorDisplay.trim());
  console.log(
    `  ${r.date} ${r.time} ${r.room} type=${r.lessonType} tutor=${r.tutorDisplay} attended=${attended} tutorMatch=${tutorMatch}`,
  );
}

const { rows: tutorRows } = await fetchTutorMonthLessonRows(matchNames, year, month);
const hits = tutorRows.filter((r) => r.studentId === studentId);
console.log(`\nTutor monthly hits for ${studentId}:`, hits.length ? hits : "(none)");
if (hits.length) console.log(hits);
