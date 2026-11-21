/**
 * Audit all students' attendance vs schedule rows (all lesson types).
 *
 *   npx tsx scripts/audit-attendance-anomalies.ts
 *   npx tsx scripts/audit-attendance-anomalies.ts --year=2026
 *   npx tsx scripts/audit-attendance-anomalies.ts --year=2026 --month=11
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  isRegularLessonAttended,
  isScheduleAttendanceMarked,
  parseRegularAttendanceRuleId,
} from "../src/lib/lessonScheduleVersions";
import {
  normalizeFeeLessonRecords,
  toYearLessonStateFromClient,
} from "../src/lib/feeRecordLessonDates";
import {
  buildStudentScheduleRows,
  type StudentLessonScheduleRow,
  type StudentScheduleMapperState,
} from "../src/lib/studentScheduleRowMapper";
import type { YearLessonRecord } from "../src/lib/yearScheduleCore";
import { PENDING_MAKEUP_TYPE_LABEL } from "../src/lib/pendingMakeup";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in .env.local");
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey);

const yearFilter = Number(
  process.argv.find((a) => a.startsWith("--year="))?.split("=")[1] ?? "2026",
);
const monthFilter = process.argv.find((a) => a.startsWith("--month="))?.split("=")[1];
const monthNum = monthFilter ? Number(monthFilter) : null;

type Issue = {
  studentId: string;
  kind: string;
  date?: string;
  lessonType?: string;
  detail: string;
};

function toYearLessonRecords(raw: unknown): YearLessonRecord[] {
  return normalizeFeeLessonRecords(raw).map((r) => ({
    ...r,
    createdAt: r.createdAt ?? Date.now(),
  }));
}

function toMapperState(raw: {
  hidden_dates?: unknown;
  overrides?: unknown;
  reschedule_entries?: unknown;
  extra_entries?: unknown;
}): StudentScheduleMapperState {
  const state = toYearLessonStateFromClient({
    attendance: {},
    hiddenDates: raw.hidden_dates,
    overrides: raw.overrides,
    rescheduleEntries: raw.reschedule_entries,
    extraEntries: raw.extra_entries,
  });
  return {
    hiddenDates: state.hiddenDates,
    overrides: state.overrides,
    rescheduleEntries: state.rescheduleEntries,
    extraEntries: state.extraEntries,
  };
}

/** Pre-fix student-page bug (for regression count only). */
function oldStudentPageAttended(
  attendance: Record<string, boolean>,
  row: Pick<StudentLessonScheduleRow, "rowKind" | "scheduleRuleId" | "attendanceKey" | "date">,
): boolean {
  if (row.rowKind === "cancelled_original") return false;
  // Intentionally naive: Extra with ex: was mis-routed through regular: lookup.
  if (row.rowKind === "normal" && row.scheduleRuleId) {
    const id = String(row.scheduleRuleId);
    if (id.startsWith("ex:") || id.startsWith("rs:")) {
      return (
        Boolean(attendance[`regular:${id}:${row.date}`]) ||
        Boolean(attendance[`regular:${id}`]) ||
        Boolean(attendance[row.date])
      );
    }
    return isRegularLessonAttended(attendance, { id }, row.date);
  }
  return Boolean(attendance[row.attendanceKey]);
}

function coreLessonType(
  row: StudentLessonScheduleRow,
): "恆常" | "補堂" | "加堂" | "取消" | typeof PENDING_MAKEUP_TYPE_LABEL {
  switch (row.lessonType) {
    case "Regular":
      return "恆常";
    case "Reschedule":
      return "補堂";
    case "Extra":
      return "加堂";
    case "Cancelled":
      return "取消";
    default:
      return PENDING_MAKEUP_TYPE_LABEL;
  }
}

function roomOrCorrectAttended(
  attendance: Record<string, boolean>,
  row: StudentLessonScheduleRow,
): boolean {
  if (row.rowKind === "cancelled_original") return false;
  return isScheduleAttendanceMarked(attendance, {
    attendanceKey: row.attendanceKey,
    dateIso: row.date,
    lessonType: coreLessonType(row),
    scheduleRuleId: row.scheduleRuleId,
  });
}

function classifyAttendanceKey(key: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return "bare_date";
  if (key.startsWith("regular:ex:")) return "regular_ex_bogus";
  if (key.startsWith("regular:rs:")) return "regular_rs_bogus";
  if (/^regular:[^:]+:\d{4}-\d{2}-\d{2}$/.test(key)) return "regular_dated";
  if (/^regular:[^:]+$/.test(key)) return "regular_legacy_id";
  if (key.startsWith("extra:")) return "extra";
  if (key.startsWith("reschedule:")) return "reschedule";
  if (key.startsWith("cancelled:")) return "cancelled";
  return "other";
}

async function main() {
  const [{ data: recordRows, error: recErr }, { data: stateRows, error: stateErr }, { data: students }] =
    await Promise.all([
      sb.from("student_lesson_records").select("student_id, records"),
      sb
        .from("student_lessons_year_state")
        .select(
          "student_id, year, attendance, hidden_dates, overrides, reschedule_entries, extra_entries",
        )
        .eq("year", yearFilter),
      sb.from("students").select("id, name_en, name_zh"),
    ]);

  if (recErr) throw new Error(recErr.message);
  if (stateErr) throw new Error(stateErr.message);

  const nameById = new Map<string, string>();
  for (const s of students ?? []) {
    const id = String(s.id ?? "").trim();
    const label = String(s.name_en || s.name_zh || id).trim();
    if (id) nameById.set(id, label);
  }

  const recordsByStudent = new Map<string, YearLessonRecord[]>();
  for (const row of recordRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    if (!sid) continue;
    recordsByStudent.set(sid, toYearLessonRecords(row.records));
  }

  const issues: Issue[] = [];
  const keyShapeCounts = new Map<string, number>();
  const trueKeyShapeCounts = new Map<string, number>();
  let checkedStudents = 0;
  let studentsWithAttendance = 0;
  let totalTrueKeys = 0;
  let totalVisibleRows = 0;
  let totalMarkedVisible = 0;

  const countsByType = {
    Regular: { rows: 0, marked: 0 },
    Extra: { rows: 0, marked: 0 },
    Reschedule: { rows: 0, marked: 0 },
    Cancelled: { rows: 0, marked: 0 },
    Pending: { rows: 0, marked: 0 },
  };

  for (const row of stateRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    if (!sid) continue;
    checkedStudents++;

    const attendance = (row.attendance ?? {}) as Record<string, boolean>;
    const trueKeys = Object.entries(attendance).filter(([, v]) => Boolean(v)).map(([k]) => k);
    if (trueKeys.length > 0) studentsWithAttendance++;
    totalTrueKeys += trueKeys.length;

    for (const k of Object.keys(attendance)) {
      const shape = classifyAttendanceKey(k);
      keyShapeCounts.set(shape, (keyShapeCounts.get(shape) ?? 0) + 1);
      if (attendance[k]) {
        trueKeyShapeCounts.set(shape, (trueKeyShapeCounts.get(shape) ?? 0) + 1);
      }
    }

    const records = recordsByStudent.get(sid) ?? [];
    const mapperState = toMapperState(row);
    let scheduleRows = buildStudentScheduleRows(
      records,
      mapperState,
      yearFilter,
      `${yearFilter}-12-31`,
    );

    if (monthNum && monthNum >= 1 && monthNum <= 12) {
      const prefix = `${yearFilter}-${String(monthNum).padStart(2, "0")}-`;
      scheduleRows = scheduleRows.filter((r) => r.date.startsWith(prefix));
    }

    const expectedKeys = new Set<string>();
    for (const r of scheduleRows) {
      expectedKeys.add(r.attendanceKey);
      if (r.scheduleRuleId && !String(r.scheduleRuleId).startsWith("ex:") && !String(r.scheduleRuleId).startsWith("rs:")) {
        expectedKeys.add(`regular:${r.scheduleRuleId}:${r.date}`);
        expectedKeys.add(`regular:${r.scheduleRuleId}`);
      }
      expectedKeys.add(r.date);
    }

    // Also allow keys for entries outside filtered month (orphan check uses full year rows).
    const fullYearRows =
      monthNum && monthNum >= 1 && monthNum <= 12
        ? buildStudentScheduleRows(records, mapperState, yearFilter, `${yearFilter}-12-31`)
        : scheduleRows;
    const yearExpectedKeys = new Set<string>();
    for (const r of fullYearRows) {
      yearExpectedKeys.add(r.attendanceKey);
      if (
        r.scheduleRuleId &&
        !String(r.scheduleRuleId).startsWith("ex:") &&
        !String(r.scheduleRuleId).startsWith("rs:")
      ) {
        yearExpectedKeys.add(`regular:${r.scheduleRuleId}:${r.date}`);
        yearExpectedKeys.add(`regular:${r.scheduleRuleId}`);
      }
      yearExpectedKeys.add(r.date);
    }

    for (const r of scheduleRows) {
      totalVisibleRows++;
      const typeBucket =
        r.lessonType === "Regular"
          ? "Regular"
          : r.lessonType === "Extra"
            ? "Extra"
            : r.lessonType === "Reschedule"
              ? "Reschedule"
              : r.lessonType === "Cancelled"
                ? "Cancelled"
                : "Pending";
      countsByType[typeBucket].rows++;

      const correct = roomOrCorrectAttended(attendance, r);
      const oldUi = oldStudentPageAttended(attendance, r);
      if (correct) {
        totalMarkedVisible++;
        countsByType[typeBucket].marked++;
      }

      // Regression probe: pre-fix student UI would hide these Extra ticks.
      if (correct && !oldUi) {
        issues.push({
          studentId: sid,
          kind: "pre_fix_ui_would_miss_tick",
          date: r.date,
          lessonType: r.lessonType,
          detail: `${r.lLabel} ${r.time} ${r.tutor} key=${r.attendanceKey} rule=${r.scheduleRuleId ?? "-"}`,
        });
      }

      // Current logic should never disagree with Room for displayable rows.
      if (!correct && oldUi) {
        issues.push({
          studentId: sid,
          kind: "ui_false_tick",
          date: r.date,
          lessonType: r.lessonType,
          detail: `${r.lLabel} ${r.time} key=${r.attendanceKey} rule=${r.scheduleRuleId ?? "-"}`,
        });
      }

      // Moved Extra shares extra:{id} with cancelled origin — OK if UI hides ✓ on cancelled.
      if (
        r.rowKind === "cancelled_original" &&
        Boolean(attendance[r.attendanceKey]) &&
        !String(r.attendanceKey).startsWith("extra:")
      ) {
        issues.push({
          studentId: sid,
          kind: "cancelled_non_extra_key_true",
          date: r.date,
          lessonType: r.lessonType,
          detail: `key=${r.attendanceKey} rowKind=${r.rowKind}`,
        });
      }

      // Bare dateIso would mark this regular lesson even without per-slot tick
      if (
        r.lessonType === "Regular" &&
        r.scheduleRuleId &&
        attendance[r.date] === true &&
        !attendance[`regular:${r.scheduleRuleId}:${r.date}`] &&
        !attendance[`regular:${r.scheduleRuleId}`]
      ) {
        issues.push({
          studentId: sid,
          kind: "bare_date_marks_regular",
          date: r.date,
          lessonType: r.lessonType,
          detail: `${r.lLabel} ${r.time} only via bare date ${r.date}`,
        });
      }

      // Legacy year-wide regular:id marks every occurrence
      if (
        r.lessonType === "Regular" &&
        r.scheduleRuleId &&
        attendance[`regular:${r.scheduleRuleId}`] === true &&
        !attendance[`regular:${r.scheduleRuleId}:${r.date}`]
      ) {
        issues.push({
          studentId: sid,
          kind: "legacy_regular_id_marks_date",
          date: r.date,
          lessonType: r.lessonType,
          detail: `${r.lLabel} via regular:${r.scheduleRuleId}`,
        });
      }
    }

    for (const key of trueKeys) {
      const shape = classifyAttendanceKey(key);
      if (shape === "regular_ex_bogus" || shape === "regular_rs_bogus") {
        issues.push({
          studentId: sid,
          kind: "bogus_regular_synthetic_key",
          detail: key,
        });
        continue;
      }
      if (shape === "cancelled" && attendance[key]) {
        issues.push({
          studentId: sid,
          kind: "cancelled_key_true",
          detail: key,
        });
      }
      if (!yearExpectedKeys.has(key)) {
        // Ignore false values already filtered; orphan true keys
        const ruleId = parseRegularAttendanceRuleId(key);
        // dated regular for a date outside visible rows still "expected" if rule exists
        if (shape === "regular_dated" && ruleId) {
          const datePart = key.slice(`regular:${ruleId}:`.length);
          const ruleStillExists = records.some((rec) => rec.id === ruleId);
          if (ruleStillExists && datePart.startsWith(String(yearFilter))) {
            // Likely a past date after schedule change / hide — soft orphan
            issues.push({
              studentId: sid,
              kind: "orphan_regular_dated_soft",
              date: datePart,
              detail: key,
            });
            continue;
          }
        }
        if (shape === "bare_date") {
          issues.push({
            studentId: sid,
            kind: "orphan_bare_date",
            date: key,
            detail: key,
          });
          continue;
        }
        if (shape === "extra") {
          issues.push({
            studentId: sid,
            kind: "orphan_extra_key",
            detail: `${key} (no matching extra entry/row)`,
          });
          continue;
        }
        if (shape === "reschedule") {
          issues.push({
            studentId: sid,
            kind: "orphan_reschedule_key",
            detail: `${key} (no matching reschedule entry/row)`,
          });
          continue;
        }
        if (shape === "regular_legacy_id") {
          issues.push({
            studentId: sid,
            kind: "orphan_legacy_regular_id",
            detail: key,
          });
          continue;
        }
        issues.push({
          studentId: sid,
          kind: "orphan_other_key",
          detail: key,
        });
      }
    }

    // Extra entry exists + attendance true, but no visible Extra/Reschedule row for that id
    for (const ex of mapperState.extraEntries) {
      const key = `extra:${ex.id}`;
      if (!attendance[key]) continue;
      const visible = fullYearRows.some(
        (r) =>
          r.extraEntryId === ex.id &&
          r.rowKind !== "cancelled_original" &&
          (r.lessonType === "Extra" || r.lessonType === "Reschedule"),
      );
      if (!visible) {
        issues.push({
          studentId: sid,
          kind: "extra_tick_no_visible_target",
          date: ex.date,
          lessonType: "Extra",
          detail: `${key} pending=${Boolean(ex.pending)} origin=${ex.originDate ?? "-"}`,
        });
      }
    }
  }

  const byKind = new Map<string, Issue[]>();
  for (const i of issues) {
    const list = byKind.get(i.kind) ?? [];
    list.push(i);
    byKind.set(i.kind, list);
  }

  console.log("=== Attendance anomalies audit ===");
  console.log(`Year: ${yearFilter}${monthNum ? `  Month filter: ${monthNum}` : " (all months)"}`);
  console.log(`Students with year state: ${checkedStudents}`);
  console.log(`Students with any true attendance key: ${studentsWithAttendance}`);
  console.log(`True attendance keys: ${totalTrueKeys}`);
  console.log(`Visible schedule rows in scope: ${totalVisibleRows}`);
  console.log(`Visible rows marked (correct logic): ${totalMarkedVisible}`);
  console.log("\nBy lesson type (rows / marked):");
  for (const [t, c] of Object.entries(countsByType)) {
    console.log(`  ${t}: ${c.rows} rows, ${c.marked} marked`);
  }

  console.log("\nAttendance key shapes (all keys / true only):");
  for (const shape of [...new Set([...keyShapeCounts.keys(), ...trueKeyShapeCounts.keys()])].sort()) {
    console.log(
      `  ${shape}: ${keyShapeCounts.get(shape) ?? 0} keys, ${trueKeyShapeCounts.get(shape) ?? 0} true`,
    );
  }

  console.log(`\nIssues found: ${issues.length}`);
  console.log("\nBy issue type:");
  for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${kind}: ${list.length}`);
  }

  const highlightKinds = [
    "ui_missed_tick",
    "ui_false_tick",
    "bogus_regular_synthetic_key",
    "bare_date_marks_regular",
    "legacy_regular_id_marks_date",
    "orphan_extra_key",
    "orphan_reschedule_key",
    "extra_tick_no_visible_target",
    "cancelled_key_true",
  ];

  for (const kind of highlightKinds) {
    const list = byKind.get(kind) ?? [];
    if (list.length === 0) continue;
    console.log(`\n--- ${kind} (first ${Math.min(25, list.length)}) ---`);
    for (const i of list.slice(0, 25)) {
      const name = nameById.get(i.studentId) ?? "";
      console.log(
        `  ${i.studentId} ${name} [${i.lessonType ?? "-"}] ${i.date ?? ""} ${i.detail}`,
      );
    }
    if (list.length > 25) console.log(`  ... +${list.length - 25} more`);
  }

  const outPath = `audit-attendance-anomalies-${yearFilter}${monthNum ? `-${monthNum}` : ""}.json`;
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        year: yearFilter,
        month: monthNum,
        checkedStudents,
        studentsWithAttendance,
        totalTrueKeys,
        totalVisibleRows,
        totalMarkedVisible,
        countsByType,
        keyShapeCounts: Object.fromEntries(keyShapeCounts),
        trueKeyShapeCounts: Object.fromEntries(trueKeyShapeCounts),
        issueCounts: Object.fromEntries(
          [...byKind.entries()].map(([k, v]) => [k, v.length]),
        ),
        issues,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
