import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";
import {
  formatAcademicYearId,
  getAcademicYear,
  getAcademicYearForMonth,
  getCurrentAcademicYear,
  academicYearLabelZh,
  promotionYearForAcademicYear,
  type AcademicYearId,
} from "@/lib/academicYear";
import { normalizeGradeCode } from "@/lib/grade";
import { inferGradeAtSheetEnd } from "@/lib/inferStudentGrade";

export type GradeHistoryStatus = "normal" | "repeating" | "promoted" | "manual_adjustment";

export type StudentGradeHistoryRow = {
  academicYear: AcademicYearId;
  grade: string;
  status: GradeHistoryStatus;
  note: string;
};

export type GradeHistoryByAcademicYear = Record<string, StudentGradeHistoryRow>;

export type GradeHistoryByStudentId = Record<string, GradeHistoryByAcademicYear>;

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("student_grade_history") &&
      (m.includes("could not find") || m.includes("not found")))
  );
}

function coerceStatus(raw: unknown): GradeHistoryStatus {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "repeating" || s === "promoted" || s === "manual_adjustment") return s;
  return "normal";
}

export function coerceGradeHistoryRow(raw: unknown): StudentGradeHistoryRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const academicYear = String(o.academicYear ?? o.academic_year ?? "").trim();
  const grade = normalizeGradeCode(String(o.grade ?? ""));
  if (!/^\d{4}-\d{2}$/.test(academicYear) || !grade) return null;
  return {
    academicYear,
    grade,
    status: coerceStatus(o.status),
    note: String(o.note ?? ""),
  };
}

export function emptyGradeHistoryMap(): GradeHistoryByAcademicYear {
  return {};
}

/**
 * Resolve grade for a fee sheet month.
 * Priority: fee_pricing_grade override (caller) → grade history → Sept-1 rollback fallback.
 */
export function getStudentGradeForMonth(params: {
  currentGrade: string;
  sheetYear: number;
  sheetMonth: number;
  historyByAcademicYear?: GradeHistoryByAcademicYear | null;
  /** Legacy held-back promotion years (Sept calendar year) for fallback only. */
  heldBackYears?: ReadonlySet<number> | readonly number[] | null;
}): string {
  const ay = getAcademicYearForMonth(params.sheetYear, params.sheetMonth);
  const hist = params.historyByAcademicYear?.[ay];
  if (hist?.grade) return normalizeGradeCode(hist.grade);
  return inferGradeAtSheetEnd(
    params.currentGrade,
    params.sheetYear,
    params.sheetMonth,
    params.heldBackYears,
  );
}

/** Resolve grade for a calendar date (YYYY-MM-DD). */
export function getStudentGradeForDate(params: {
  currentGrade: string;
  dateIso: string;
  historyByAcademicYear?: GradeHistoryByAcademicYear | null;
  heldBackYears?: ReadonlySet<number> | readonly number[] | null;
}): string {
  const iso = String(params.dateIso ?? "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return normalizeGradeCode(params.currentGrade);
  return getStudentGradeForMonth({
    currentGrade: params.currentGrade,
    sheetYear: Number(m[1]),
    sheetMonth: Number(m[2]),
    historyByAcademicYear: params.historyByAcademicYear,
    heldBackYears: params.heldBackYears,
  });
}

export function listGradeHistoryRows(
  historyByAcademicYear: GradeHistoryByAcademicYear | null | undefined,
): StudentGradeHistoryRow[] {
  if (!historyByAcademicYear) return [];
  return Object.values(historyByAcademicYear).sort((a, b) =>
    a.academicYear.localeCompare(b.academicYear),
  );
}

export async function loadGradeHistoryByStudentIds(
  studentIds: string[],
): Promise<{
  byStudentId: GradeHistoryByStudentId;
  error?: string;
  tableMissing?: boolean;
}> {
  if (!studentIds.length) return { byStudentId: {} };
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    query: (chunk) =>
      supabase
        .from("student_grade_history")
        .select("student_id, academic_year, grade, status, note")
        .in("student_id", chunk),
  });
  if (error) {
    return {
      byStudentId: {},
      error,
      tableMissing: isMissingTableError(error),
    };
  }
  const byStudentId: GradeHistoryByStudentId = {};
  for (const row of data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    const coerced = coerceGradeHistoryRow(row);
    if (!sid || !coerced) continue;
    if (!byStudentId[sid]) byStudentId[sid] = {};
    byStudentId[sid][coerced.academicYear] = coerced;
  }
  return { byStudentId };
}

export async function upsertStudentGradeHistory(params: {
  studentId: string;
  academicYear: string;
  grade: string;
  status: GradeHistoryStatus;
  note?: string;
}): Promise<{ ok: boolean; error?: string; tableMissing?: boolean }> {
  const { supabase } = await import("@/lib/supabase");
  const grade = normalizeGradeCode(params.grade);
  if (!grade) return { ok: false, error: "Invalid grade" };
  if (!/^\d{4}-\d{2}$/.test(params.academicYear)) {
    return { ok: false, error: "Invalid academic year" };
  }
  const { error } = await supabase.from("student_grade_history").upsert(
    {
      student_id: params.studentId,
      academic_year: params.academicYear,
      grade,
      status: params.status,
      note: params.note ?? "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id,academic_year" },
  );
  if (error) {
    return {
      ok: false,
      error: error.message,
      tableMissing: isMissingTableError(error.message),
    };
  }
  return { ok: true };
}

/**
 * Set current academic year status to repeating / normal.
 * - repeating: keep current grade, status=repeating; also mirror legacy held_back_years
 * - normal: status=normal (grade unchanged unless nextGrade provided)
 */
export async function setCurrentAcademicYearStatus(params: {
  studentId: string;
  currentGrade: string;
  repeating: boolean;
  /** When turning off repeating, optional grade to store (default: keep current). */
  grade?: string;
}): Promise<{ ok: boolean; error?: string; tableMissing?: boolean; academicYear: string }> {
  const academicYear = getCurrentAcademicYear();
  const grade = normalizeGradeCode(params.grade ?? params.currentGrade);
  const status: GradeHistoryStatus = params.repeating ? "repeating" : "normal";
  const hist = await upsertStudentGradeHistory({
    studentId: params.studentId,
    academicYear,
    grade,
    status,
    note: params.repeating ? "repeating" : "",
  });
  if (!hist.ok) {
    return { ...hist, academicYear };
  }

  // Keep legacy held_back_years in sync so old promotion SQL still works until migrated.
  const promoYear = promotionYearForAcademicYear(academicYear);
  if (promoYear != null) {
    const { replaceStudentHeldBackYears, loadHeldBackYearsByStudentIds } = await import(
      "@/lib/studentHeldBackYears"
    );
    const existing = await loadHeldBackYearsByStudentIds([params.studentId]);
    const prev = existing.byStudentId[params.studentId] ?? [];
    const next = params.repeating
      ? Array.from(new Set([...prev, promoYear])).sort((a, b) => a - b)
      : prev.filter((y) => y !== promoYear);
    const sync = await replaceStudentHeldBackYears(params.studentId, next, "repeating sync");
    if (!sync.ok) {
      return { ok: false, error: sync.error, tableMissing: sync.tableMissing, academicYear };
    }
  }

  return { ok: true, academicYear };
}

/** Build a single-year history map entry helper for tests / UI. */
export function historyEntry(
  academicYear: string,
  grade: string,
  status: GradeHistoryStatus = "normal",
): GradeHistoryByAcademicYear {
  return {
    [academicYear]: {
      academicYear,
      grade: normalizeGradeCode(grade),
      status,
      note: "",
    },
  };
}

export function ensureCurrentYearHistoryFallback(params: {
  currentGrade: string;
  historyByAcademicYear?: GradeHistoryByAcademicYear | null;
  heldBackYears?: readonly number[] | null;
}): GradeHistoryByAcademicYear {
  const ay = getCurrentAcademicYear();
  const map = { ...(params.historyByAcademicYear ?? {}) };
  if (map[ay]) return map;
  const promo = promotionYearForAcademicYear(ay);
  const repeating =
    promo != null && Array.isArray(params.heldBackYears) && params.heldBackYears.includes(promo);
  map[ay] = {
    academicYear: ay,
    grade: normalizeGradeCode(params.currentGrade),
    status: repeating ? "repeating" : "normal",
    note: repeating ? "from held_back_years" : "from students.grade",
  };
  return map;
}

export { formatAcademicYearId, getAcademicYear, getAcademicYearForMonth, getCurrentAcademicYear, academicYearLabelZh };
