/**
 * Audit all students: cross-month reschedule should keep Lx on origin month,
 * "/" on target month, and fee-record billable dates on from-date month only.
 *
 *   npx tsx scripts/audit-cross-month-reschedule-logic.ts
 *   npx tsx scripts/audit-cross-month-reschedule-logic.ts --year=2026
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  collectBillableLessonDatesForMonth,
  normalizeFeeLessonRecords,
  toYearLessonStateFromClient,
} from "../src/lib/feeRecordLessonDates";
import {
  buildStudentScheduleRows,
  type StudentScheduleMapperState,
} from "../src/lib/studentScheduleRowMapper";
import type { YearLessonRecord } from "../src/lib/yearScheduleCore";

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

function monthFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Number(m[2]) : 0;
}

function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])}/${Number(m[2])}`;
}

type Issue = {
  studentId: string;
  kind: string;
  detail: string;
};

async function main() {
  const [{ data: recordRows, error: recErr }, { data: stateRows, error: stateErr }] =
    await Promise.all([
      sb.from("student_lesson_records").select("student_id, records"),
      sb
        .from("student_lessons_year_state")
        .select("student_id, year, hidden_dates, overrides, reschedule_entries, extra_entries")
        .eq("year", yearFilter),
    ]);

  if (recErr) throw new Error(recErr.message);
  if (stateErr) throw new Error(stateErr.message);

  const recordsByStudent = new Map<string, YearLessonRecord[]>();
  for (const row of recordRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    if (!sid) continue;
    recordsByStudent.set(sid, toYearLessonRecords(row.records));
  }

  const issues: Issue[] = [];
  let studentsWithCrossMonth = 0;
  let crossMonthEntries = 0;
  let checkedStudents = 0;
  const crossMonthStudentIds: string[] = [];

  for (const row of stateRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    if (!sid) continue;
    checkedStudents++;

    const records = recordsByStudent.get(sid) ?? [];
    const mapperState = toMapperState(row);
    const yearState = toYearLessonStateFromClient({
      attendance: {},
      hiddenDates: row.hidden_dates,
      overrides: row.overrides,
      rescheduleEntries: row.reschedule_entries,
      extraEntries: row.extra_entries,
    });

    const crossMonth = mapperState.rescheduleEntries.filter((e) => {
      if (e.pending || !e.fromDate || !e.toDate) return false;
      return monthFromIso(e.fromDate) !== monthFromIso(e.toDate);
    });

    if (crossMonth.length === 0) continue;

    studentsWithCrossMonth++;
    crossMonthStudentIds.push(sid);
    crossMonthEntries += crossMonth.length;

    const allRows = buildStudentScheduleRows(records, mapperState, yearFilter, "2026-12-31");

    for (const entry of crossMonth) {
      const fromMonth = monthFromIso(entry.fromDate);
      const toMonth = monthFromIso(entry.toDate);

      const cancelled = allRows.find(
        (r) =>
          r.date === entry.fromDate &&
          r.rowKind === "cancelled_original" &&
          r.rescheduleEntryId === entry.id,
      );
      const reschedule = allRows.find(
        (r) =>
          r.date === entry.toDate &&
          r.rowKind === "reschedule" &&
          r.rescheduleEntryId === entry.id,
      );

      if (!cancelled) {
        issues.push({
          studentId: sid,
          kind: "missing_cancelled_row",
          detail: `${entry.fromDate}→${entry.toDate} (id ${entry.id})`,
        });
      } else if (cancelled.lLabel === "/" || !/^L\d+$/.test(cancelled.lLabel)) {
        issues.push({
          studentId: sid,
          kind: "cancelled_not_lx",
          detail: `${entry.fromDate} lLabel=${cancelled.lLabel}`,
        });
      }

      if (!reschedule) {
        issues.push({
          studentId: sid,
          kind: "missing_reschedule_row",
          detail: `${entry.fromDate}→${entry.toDate} (id ${entry.id})`,
        });
      } else if (reschedule.lLabel !== "/") {
        issues.push({
          studentId: sid,
          kind: "reschedule_not_slash",
          detail: `${entry.toDate} lLabel=${reschedule.lLabel} (from ${entry.fromDate})`,
        });
      }

      const fromBillable = collectBillableLessonDatesForMonth({
        records,
        state: yearState,
        year: yearFilter,
        month1to12: fromMonth,
      });
      const toBillable = collectBillableLessonDatesForMonth({
        records,
        state: yearState,
        year: yearFilter,
        month1to12: toMonth,
      });

      const fromDisplay = isoToDisplay(entry.fromDate);
      const toDisplay = isoToDisplay(entry.toDate);

      if (!fromBillable.includes(fromDisplay)) {
        issues.push({
          studentId: sid,
          kind: "fee_missing_from_month",
          detail: `${fromDisplay} not in month ${fromMonth} billable [${fromBillable.join(", ")}]`,
        });
      }

      // toDate may legitimately appear when it is also a regular weekday slot.
      const stateWithoutReschedule = {
        ...yearState,
        rescheduleEntries: yearState.rescheduleEntries.filter((e) => e.id !== entry.id),
      };
      const toBillableWithout = collectBillableLessonDatesForMonth({
        records,
        state: stateWithoutReschedule,
        year: yearFilter,
        month1to12: toMonth,
      });
      if (
        toBillable.includes(toDisplay) &&
        !toBillableWithout.includes(toDisplay)
      ) {
        issues.push({
          studentId: sid,
          kind: "fee_extra_reschedule_to_month",
          detail: `${toDisplay} only in month ${toMonth} because of reschedule from ${entry.fromDate}`,
        });
      }
    }
  }

  console.log("=== Cross-month reschedule audit ===");
  console.log(`Year: ${yearFilter}`);
  console.log(`Students with year state: ${checkedStudents}`);
  console.log(`Students with cross-month reschedule: ${studentsWithCrossMonth}`);
  if (crossMonthStudentIds.length > 0) {
    console.log(`  IDs: ${crossMonthStudentIds.sort().join(", ")}`);
  }
  console.log(`Cross-month reschedule entries: ${crossMonthEntries}`);
  console.log(`Issues found: ${issues.length}`);

  if (issues.length > 0) {
    const byKind = new Map<string, number>();
    for (const i of issues) {
      byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
    }
    console.log("\nBy issue type:");
    for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${kind}: ${count}`);
    }
    console.log("\nFirst 30 issues:");
    for (const i of issues.slice(0, 30)) {
      console.log(`  ${i.studentId} [${i.kind}] ${i.detail}`);
    }
    if (issues.length > 30) console.log(`  ... and ${issues.length - 30} more`);
  } else {
    console.log("\nAll cross-month reschedule students pass L-label and fee-record checks.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
