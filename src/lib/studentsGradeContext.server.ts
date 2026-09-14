import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  SCHEDULE_CACHE_TAG_AGGREGATES,
  SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
} from "@/lib/scheduleCacheTags";
import type { GradeHistoryByStudentId, GradeHistoryStatus } from "@/lib/studentGradeHistory";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type StudentsGradeContext = {
  heldBackYearsByStudentId: Record<string, number[]>;
  gradeHistoryByStudentId: GradeHistoryByStudentId;
};

function isSoftMissingTableError(message: string, table: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes(table) && (m.includes("could not find") || m.includes("not found")))
  );
}

function parseHeldBackYears(
  rows: Array<{ student_id?: string; promotion_year?: number; academic_year?: number }> | null,
): Record<string, number[]> {
  const byStudentId: Record<string, number[]> = {};
  for (const row of rows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    const year = Math.trunc(Number(row.promotion_year ?? row.academic_year));
    if (!sid || !Number.isFinite(year)) continue;
    if (!byStudentId[sid]) byStudentId[sid] = [];
    byStudentId[sid].push(year);
  }
  for (const sid of Object.keys(byStudentId)) {
    byStudentId[sid] = Array.from(new Set(byStudentId[sid])).sort((a, b) => a - b);
  }
  return byStudentId;
}

function parseGradeHistory(
  rows: Array<{
    student_id?: string;
    academic_year?: string;
    grade?: string;
    status?: string;
    note?: string;
  }> | null,
): GradeHistoryByStudentId {
  const byStudentId: GradeHistoryByStudentId = {};
  for (const row of rows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    const academicYear = String(row.academic_year ?? "").trim();
    const grade = String(row.grade ?? "").trim();
    if (!sid || !/^\d{4}-\d{2}$/.test(academicYear) || !grade) continue;
    const statusRaw = String(row.status ?? "normal").trim().toLowerCase();
    const status: GradeHistoryStatus =
      statusRaw === "repeating" || statusRaw === "promoted" || statusRaw === "manual_adjustment"
        ? statusRaw
        : "normal";
    if (!byStudentId[sid]) byStudentId[sid] = {};
    byStudentId[sid][academicYear] = {
      academicYear,
      grade,
      status,
      note: String(row.note ?? ""),
    };
  }
  return byStudentId;
}

const loadStudentsGradeContextCached = unstable_cache(
  async (): Promise<StudentsGradeContext> => {
    const supabase = getSupabaseAdmin();
    const [{ data: heldBackRows, error: heldBackErr }, { data: gradeHistoryRows, error: gradeErr }] =
      await Promise.all([
        supabase.from("student_held_back_years").select("student_id, promotion_year"),
        supabase
          .from("student_grade_history")
          .select("student_id, academic_year, grade, status, note"),
      ]);

    const heldBackYearsByStudentId =
      heldBackErr && !isSoftMissingTableError(heldBackErr.message, "student_held_back_years")
        ? {}
        : parseHeldBackYears(
            (heldBackRows ?? []) as Array<{
              student_id?: string;
              promotion_year?: number;
              academic_year?: number;
            }>,
          );

    const gradeHistoryByStudentId =
      gradeErr && !isSoftMissingTableError(gradeErr.message, "student_grade_history")
        ? {}
        : parseGradeHistory(
            (gradeHistoryRows ?? []) as Array<{
              student_id?: string;
              academic_year?: string;
              grade?: string;
              status?: string;
              note?: string;
            }>,
          );

    // Soft-fail unknown errors to empty maps (same tolerance as prior timetable path).
    if (heldBackErr && !isSoftMissingTableError(heldBackErr.message, "student_held_back_years")) {
      console.warn("[studentsGradeContext] held_back_years:", heldBackErr.message);
    }
    if (gradeErr && !isSoftMissingTableError(gradeErr.message, "student_grade_history")) {
      console.warn("[studentsGradeContext] grade_history:", gradeErr.message);
    }

    return { heldBackYearsByStudentId, gradeHistoryByStudentId };
  },
  ["students-grade-context-v1"],
  {
    revalidate: 300,
    tags: [SCHEDULE_CACHE_TAG_DAY_TIMETABLE, SCHEDULE_CACHE_TAG_AGGREGATES],
  },
);

/** Shared held-back + grade-history maps (Data Cache + request memo). */
export const loadStudentsGradeContext = cache(async (): Promise<StudentsGradeContext> => {
  return loadStudentsGradeContextCached();
});
