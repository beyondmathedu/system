import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import {
  FEE_OPENING_BALANCE_AS_OF_MONTH,
  FEE_OPENING_BALANCE_AS_OF_YEAR,
} from "@/lib/studentFeeOpeningBalance";
import {
  DEFAULT_LESSON_YEAR_STATE,
  parseLessonYearStateDbRow,
  type StudentLesson2026State,
} from "@/lib/lessonYearStateShared";
import {
  LEGACY_2026_STATE_SELECT,
  LEGACY_LESSON_STATE_YEAR,
  isMissingLessonMetricsTableError,
  mergeYearStateWithLegacyFallback,
  mergeYearStatesBatchWithLegacyFallback,
  parseLegacy2026StateRows,
  studentIdsNeedingLegacyStateFallback,
} from "@/lib/lessonYearStateLegacy";
import {
  FEE_RECORD_SELECT_WITH_SPLIT_REMARKS,
  FEE_RECORD_SELECT_WITH_SPLIT_REMARKS_LEGACY,
  FEE_RECORD_SELECT_LEGACY_NO_PAID_COUNT,
  isMissingFeeRecordColumnError,
  normalizeFeeRecordRow,
} from "@/lib/studentMonthlyFeeRecordsCompat";
import { SCHEDULE_CACHE_TAG_FEE_RECORD } from "@/lib/scheduleCacheTags";
import {
  loadStudentFeeTierSettingsAdmin,
} from "@/lib/studentFeeTierSettings";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";
import {
  buildStudentInactivePeriodsById,
  normalizeOptionalIsoDate,
  type StudentInactivePeriod,
} from "@/lib/studentVisibility";
import { loadRoomSlotTutorRulesCached } from "@/lib/roomSlotTutorRules";

export type StudentExamInfo = {
  examDate: string;
  examContent: string;
};

export type FeeRecordBootstrapRow = ReturnType<typeof normalizeFeeRecordRow>;

const FEE_SYSTEM_START_YEAR = 2026;
const FEE_SYSTEM_START_MONTH = 5;

export function feeSystemStartMonth1to12(sheetYear: number): number {
  return sheetYear === FEE_SYSTEM_START_YEAR ? FEE_SYSTEM_START_MONTH : 1;
}

export function monthEndIso(year: number, month1to12: number): string {
  const day = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  return `${year}-${String(month1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function loadExamInfoServer(
  supabase: SupabaseClient,
  studentId: string,
): Promise<StudentExamInfo> {
  const { data, error } = await supabase
    .from("student_exam_dates")
    .select("exam_date, exam_content")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    const { data: fallback } = await supabase
      .from("student_exam_dates")
      .select("exam_date")
      .eq("student_id", studentId)
      .maybeSingle();
    return {
      examDate: (fallback?.exam_date as string | null) ?? "",
      examContent: "",
    };
  }

  return {
    examDate: (data?.exam_date as string | null) ?? "",
    examContent: data?.exam_content ? String(data.exam_content) : "",
  };
}

export type StudentVisibilityModeServer = {
  mode: "active" | "inactive";
  effective_date: string;
  reactivate_date: string | null;
};

function hkTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export type StudentInactivePeriodRowServer = {
  id?: number;
  student_id: string;
  start_date: string;
  end_date: string | null;
  note: string;
};

function isMissingVisibilityPeriodsTableError(message: string): boolean {
  const m = String(message ?? "").toLowerCase();
  return (
    m.includes("student_visibility_periods") &&
    (m.includes("does not exist") || m.includes("schema cache") || m.includes("not found"))
  );
}

export async function loadStudentInactivePeriodsBatchServer(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<StudentInactivePeriodRowServer[]> {
  if (!studentIds.length) return [];
  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
    query: (chunk) =>
      supabase
        .from("student_visibility_periods")
        .select("id, student_id, start_date, end_date, note")
        .in("student_id", chunk)
        .order("start_date", { ascending: true }),
  });

  if (error) {
    if (!isMissingVisibilityPeriodsTableError(error)) throw new Error(error);
    // Fallback to legacy single-row mode.
    const legacy = await fetchRowsInChunks({
      ids: studentIds,
      concurrency: 8,
      query: (chunk) =>
        supabase
          .from("student_visibility_modes")
          .select("student_id, mode, effective_date, reactivate_date")
          .in("student_id", chunk),
    });
    if (legacy.error) throw new Error(legacy.error);
    const out: StudentInactivePeriodRowServer[] = [];
    for (const row of legacy.data ?? []) {
      const mode = String((row as { mode?: string }).mode ?? "active").toLowerCase();
      if (mode !== "inactive") continue;
      const sid = String((row as { student_id?: string }).student_id ?? "").trim();
      const start = String((row as { effective_date?: string }).effective_date ?? "").trim();
      if (!sid || !start) continue;
      out.push({
        student_id: sid,
        start_date: start,
        end_date: normalizeOptionalIsoDate((row as { reactivate_date?: string | null }).reactivate_date),
        note: "fallback: student_visibility_modes",
      });
    }
    return out;
  }

  return (data ?? []).map((row) => {
    const idRaw = (row as { id?: number | string | null }).id;
    const idNum = idRaw == null || idRaw === "" ? NaN : Number(idRaw);
    return {
      ...(Number.isFinite(idNum) && idNum > 0 ? { id: idNum } : {}),
      student_id: String((row as { student_id?: string }).student_id ?? ""),
      start_date: String((row as { start_date?: string }).start_date ?? ""),
      end_date: normalizeOptionalIsoDate((row as { end_date?: string | null }).end_date),
      note: String((row as { note?: string | null }).note ?? ""),
    };
  });
}

export async function loadStudentVisibilityModeServer(
  supabase: SupabaseClient,
  studentId: string,
): Promise<StudentVisibilityModeServer> {
  const defaultDate = hkTodayIso();

  // Prefer new periods model.
  try {
    const { data, error } = await supabase
      .from("student_visibility_periods")
      .select("start_date, end_date")
      .eq("student_id", studentId)
      .order("start_date", { ascending: true });
    if (error) throw error;
    const today = defaultDate;
    const active = (data ?? [])
      .map((r) => ({
        start: String((r as { start_date?: string }).start_date ?? "").trim(),
        end: normalizeOptionalIsoDate((r as { end_date?: string | null }).end_date),
      }))
      .filter((p) => p.start && p.start <= today && (!p.end || today < p.end))
      .sort((a, b) => b.start.localeCompare(a.start))[0];
    if (active) {
      return { mode: "inactive", effective_date: active.start, reactivate_date: active.end };
    }
    return { mode: "active", effective_date: defaultDate, reactivate_date: null };
  } catch {
    // fall back to legacy below
  }

  const { data, error } = await supabase
    .from("student_visibility_modes")
    .select("student_id, mode, effective_date, reactivate_date")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error && /reactivate_date/i.test(error.message)) {
    const { data: fallback } = await supabase
      .from("student_visibility_modes")
      .select("student_id, mode, effective_date")
      .eq("student_id", studentId)
      .maybeSingle();
    if (!fallback) {
      return { mode: "active", effective_date: defaultDate, reactivate_date: null };
    }
    const rawMode = String(fallback.mode ?? "active").toLowerCase();
    return {
      mode: rawMode === "inactive" ? "inactive" : "active",
      effective_date: String(fallback.effective_date ?? defaultDate),
      reactivate_date: null,
    };
  }

  if (!data) {
    return { mode: "active", effective_date: defaultDate, reactivate_date: null };
  }

  const rawMode = String(data.mode ?? "active").toLowerCase();
  return {
    mode: rawMode === "inactive" ? "inactive" : "active",
    effective_date: String(data.effective_date ?? defaultDate),
    reactivate_date: normalizeOptionalIsoDate(
      (data as { reactivate_date?: string | null }).reactivate_date,
    ),
  };
}

export async function loadLessonScheduleRecordsServer(
  supabase: SupabaseClient,
  studentId: string,
): Promise<unknown[]> {
  const { data } = await supabase
    .from("student_lesson_records")
    .select("records")
    .eq("student_id", studentId)
    .maybeSingle();
  if (!data?.records || !Array.isArray(data.records)) return [];
  return data.records;
}

async function loadLegacy2026StatesBatchServer(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<Record<string, StudentLesson2026State>> {
  if (!studentIds.length) return {};
  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
    query: (chunk) =>
      supabase.from("student_lessons_2026_state").select(LEGACY_2026_STATE_SELECT).in("student_id", chunk),
  });
  if (error) throw new Error(error);
  return parseLegacy2026StateRows(data as Array<Record<string, unknown>>);
}

export async function loadLessonYearStateServer(
  supabase: SupabaseClient,
  studentId: string,
  year: number,
): Promise<StudentLesson2026State> {
  const { data } = await supabase
    .from("student_lessons_year_state")
    .select("attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
    .eq("student_id", studentId)
    .eq("year", year)
    .maybeSingle();
  const yearState = data
    ? parseLessonYearStateDbRow(data as Record<string, unknown>)
    : { ...DEFAULT_LESSON_YEAR_STATE };
  if (year !== LEGACY_LESSON_STATE_YEAR) return yearState;

  const legacyMap = await loadLegacy2026StatesBatchServer(supabase, [studentId]);
  return mergeYearStateWithLegacyFallback(yearState, legacyMap[studentId], year);
}

export async function loadLessonScheduleRecordsBatchServer(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<Record<string, unknown[]>> {
  if (!studentIds.length) return {};
  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
    query: (chunk) =>
      supabase.from("student_lesson_records").select("student_id, records").in("student_id", chunk),
  });
  if (error) throw new Error(error);
  const out: Record<string, unknown[]> = {};
  for (const row of data) {
    out[String((row as { student_id?: string }).student_id)] = Array.isArray(
      (row as { records?: unknown }).records,
    )
      ? ((row as { records: unknown[] }).records as unknown[])
      : [];
  }
  return out;
}

export async function loadLessonYearStatesBatchServer(
  supabase: SupabaseClient,
  studentIds: string[],
  year: number,
): Promise<Record<string, StudentLesson2026State>> {
  if (!studentIds.length) return {};
  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
    query: (chunk) =>
      supabase
        .from("student_lessons_year_state")
        .select("student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
        .eq("year", year)
        .in("student_id", chunk),
  });
  if (error) throw new Error(error);
  const yearStates = parseLegacy2026StateRows(data as Array<Record<string, unknown>>);

  const needLegacy = studentIdsNeedingLegacyStateFallback(studentIds, yearStates, year);
  if (!needLegacy.length) {
    return mergeYearStatesBatchWithLegacyFallback(studentIds, year, yearStates, {});
  }

  const legacyStates = await loadLegacy2026StatesBatchServer(supabase, needLegacy);
  return mergeYearStatesBatchWithLegacyFallback(studentIds, year, yearStates, legacyStates);
}

async function loadLessonMetricsBatchServer(
  supabase: SupabaseClient,
  studentIds: string[],
  year: number,
): Promise<{ data: Array<Record<string, unknown>>; error: string | null }> {
  if (!studentIds.length) return { data: [], error: null };

  const yearResult = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
    query: (chunk) =>
      supabase
        .from("student_lessons_year_metrics")
        .select("student_id, remedial_count")
        .eq("year", year)
        .in("student_id", chunk),
  });

  if (yearResult.error && !isMissingLessonMetricsTableError(yearResult.error)) {
    return { data: [], error: yearResult.error };
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const row of yearResult.data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (sid) byId.set(sid, row as Record<string, unknown>);
  }

  if (year !== LEGACY_LESSON_STATE_YEAR) {
    return { data: [...byId.values()], error: null };
  }

  const missing = studentIds.filter((id) => !byId.has(id));
  if (!missing.length) return { data: [...byId.values()], error: null };

  const legacyResult = await fetchRowsInChunks({
    ids: missing,
    concurrency: 8,
    query: (chunk) =>
      supabase
        .from("student_lessons_2026_metrics")
        .select("student_id, remedial_count")
        .in("student_id", chunk),
  });
  if (legacyResult.error) return { data: [], error: legacyResult.error };

  for (const row of legacyResult.data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (sid && !byId.has(sid)) byId.set(sid, row as Record<string, unknown>);
  }

  return { data: [...byId.values()], error: null };
}

export async function loadStudentMonthlyFeeRecordsInMonthRangeServer(
  supabase: SupabaseClient,
  params: {
    studentIds: string[];
    year: number;
    monthFrom: number;
    monthTo: number;
  },
): Promise<FeeRecordBootstrapRow[]> {
  const { studentIds, year, monthFrom, monthTo } = params;
  if (!studentIds.length || monthTo < monthFrom) return [];

  async function loadWithSelect(select: string) {
    const { data, error } = await fetchRowsInChunks<Record<string, unknown>>({
      ids: studentIds,
      concurrency: 8,
      query: async (chunk) => {
        const result = await supabase
          .from("student_monthly_fee_records")
          .select(select)
          .eq("year", year)
          .gte("month", monthFrom)
          .lte("month", monthTo)
          .in("student_id", chunk);
        return {
          data: (result.data ?? []) as unknown as Record<string, unknown>[],
          error: result.error,
        };
      },
    });
    if (error) throw new Error(error);
    return data;
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await loadWithSelect(FEE_RECORD_SELECT_WITH_SPLIT_REMARKS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isMissingFeeRecordColumnError(msg)) throw e;
    try {
      rows = await loadWithSelect(FEE_RECORD_SELECT_WITH_SPLIT_REMARKS_LEGACY);
    } catch (e2) {
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      if (!isMissingFeeRecordColumnError(msg2)) throw e2;
      rows = await loadWithSelect(FEE_RECORD_SELECT_LEGACY_NO_PAID_COUNT);
    }
  }

  return rows.map((row) => normalizeFeeRecordRow(row));
}

function isMissingOpeningBalanceTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("student_fee_opening_balances") &&
      (m.includes("could not find") || m.includes("not found")))
  );
}

function isMissingBalanceAdjustmentTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("student_fee_balance_adjustments") &&
      (m.includes("could not find") || m.includes("not found")))
  );
}

function isMissingHeldBackYearsTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("student_held_back_years") &&
      (m.includes("could not find") || m.includes("not found")))
  );
}

function isMissingGradeHistoryTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("student_grade_history") &&
      (m.includes("could not find") || m.includes("not found")))
  );
}

export async function loadStudentFeeOpeningBalancesServer(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<{ balances: Record<string, number>; error?: string; tableMissing?: boolean }> {
  if (!studentIds.length) return { balances: {} };

  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
    query: (chunk) =>
      supabase
        .from("student_fee_opening_balances")
        .select("student_id, opening_balance")
        .eq("as_of_year", FEE_OPENING_BALANCE_AS_OF_YEAR)
        .eq("as_of_month", FEE_OPENING_BALANCE_AS_OF_MONTH)
        .in("student_id", chunk),
  });

  if (error) {
    return {
      balances: {},
      error,
      tableMissing: isMissingOpeningBalanceTableError(error),
    };
  }

  const balances: Record<string, number> = {};
  for (const row of data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    balances[sid] = Number((row as { opening_balance?: number | null }).opening_balance ?? 0) || 0;
  }
  return { balances };
}

export async function loadStudentFeeBalanceAdjustmentsServer(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<{
  adjustments: Record<string, { amount: number; reason: string }>;
  error?: string;
  tableMissing?: boolean;
}> {
  if (!studentIds.length) return { adjustments: {} };

  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
    query: (chunk) =>
      supabase
        .from("student_fee_balance_adjustments")
        .select("student_id, amount, reason")
        .in("student_id", chunk),
  });

  if (error) {
    return {
      adjustments: {},
      error,
      tableMissing: isMissingBalanceAdjustmentTableError(error),
    };
  }

  const adjustments: Record<string, { amount: number; reason: string }> = {};
  for (const row of data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    adjustments[sid] = {
      amount: Number((row as { amount?: number | null }).amount ?? 0) || 0,
      reason: String((row as { reason?: string | null }).reason ?? ""),
    };
  }
  return { adjustments };
}

export async function loadStudentHeldBackYearsServer(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<{
  byStudentId: Record<string, number[]>;
  error?: string;
  tableMissing?: boolean;
}> {
  if (!studentIds.length) return { byStudentId: {} };

  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
    query: (chunk) =>
      supabase.from("student_held_back_years").select("student_id, promotion_year").in("student_id", chunk),
  });

  if (error) {
    return {
      byStudentId: {},
      error,
      tableMissing: isMissingHeldBackYearsTableError(error),
    };
  }

  const byStudentId: Record<string, number[]> = {};
  for (const row of data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    const year = Math.trunc(
      Number(
        (row as { promotion_year?: number; academic_year?: number }).promotion_year ??
          (row as { academic_year?: number }).academic_year,
      ),
    );
    if (!sid || !Number.isFinite(year)) continue;
    if (!byStudentId[sid]) byStudentId[sid] = [];
    byStudentId[sid].push(year);
  }
  for (const sid of Object.keys(byStudentId)) {
    byStudentId[sid] = Array.from(new Set(byStudentId[sid])).sort((a, b) => a - b);
  }
  return { byStudentId };
}

export type FeeRecordGradeHistoryRow = {
  academicYear: string;
  grade: string;
  status: "normal" | "repeating" | "promoted" | "manual_adjustment";
  note: string;
};

export async function loadStudentGradeHistoryServer(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<{
  byStudentId: Record<string, Record<string, FeeRecordGradeHistoryRow>>;
  error?: string;
  tableMissing?: boolean;
}> {
  if (!studentIds.length) return { byStudentId: {} };

  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
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
      tableMissing: isMissingGradeHistoryTableError(error),
    };
  }

  const byStudentId: Record<string, Record<string, FeeRecordGradeHistoryRow>> = {};
  for (const row of data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    const academicYear = String((row as { academic_year?: string }).academic_year ?? "").trim();
    const grade = String((row as { grade?: string }).grade ?? "").trim();
    if (!sid || !/^\d{4}-\d{2}$/.test(academicYear) || !grade) continue;
    const statusRaw = String((row as { status?: string }).status ?? "normal")
      .trim()
      .toLowerCase();
    const status: FeeRecordGradeHistoryRow["status"] =
      statusRaw === "repeating" ||
      statusRaw === "promoted" ||
      statusRaw === "manual_adjustment"
        ? statusRaw
        : "normal";
    if (!byStudentId[sid]) byStudentId[sid] = {};
    byStudentId[sid][academicYear] = {
      academicYear,
      grade,
      status,
      note: String((row as { note?: string }).note ?? ""),
    };
  }
  return { byStudentId };
}

export type FeeRecordStudentVisibility = {
  periods: StudentInactivePeriod[];
};

export type FeeRecordBootstrapStudent = {
  id: string;
  name_zh: string;
  name_en: string;
  nickname_en: string;
  grade: string;
  student_phone: string;
  created_at: string;
};

/** Admin fee sheet: students + bulk lesson/fee data in one server pass. */
export async function loadFeeRecordBootstrap(
  supabase: SupabaseClient,
  params: { sheetYear: number; sheetMonth: number },
) {
  const { sheetYear, sheetMonth } = params;
  const currentMonth = sheetMonth;

  const { data: studentRows, error: studentErr } = await supabase
    .from("students")
    .select("id, name_zh, name_en, nickname_en, grade, student_phone, created_at")
    .order("id");
  if (studentErr) throw new Error(studentErr.message);

  const allIds = (studentRows ?? []).map((r) => String(r.id ?? "")).filter(Boolean);
  let visibilityRows: Array<{
    student_id?: string;
    start_date?: string;
    end_date?: string | null;
    note?: string | null;
  }> = [];
  if (allIds.length) {
    const vis = await fetchRowsInChunks({
      ids: allIds,
      concurrency: 8,
      query: (chunk) =>
        supabase
          .from("student_visibility_periods")
          .select("student_id, start_date, end_date, note")
          .in("student_id", chunk),
    });
    if (vis.error) throw new Error(vis.error);
    visibilityRows = vis.data;
  }

  const periodsById = buildStudentInactivePeriodsById(visibilityRows ?? []);

  const students: FeeRecordBootstrapStudent[] = (studentRows ?? [])
    .map((r) => ({
      id: String(r.id ?? ""),
      name_zh: String(r.name_zh ?? ""),
      name_en: String(r.name_en ?? ""),
      nickname_en: String(r.nickname_en ?? ""),
      grade: String(r.grade ?? ""),
      student_phone: String((r as { student_phone?: string | null }).student_phone ?? ""),
      created_at: String((r as { created_at?: string | null }).created_at ?? ""),
    }))
    .filter((s) => Boolean(s.id));

  const ids = students.map((s) => s.id);
  const feeStartMonth = feeSystemStartMonth1to12(sheetYear);
  const endMonthForPricing = currentMonth - 1;

  const openingPromise =
    sheetYear === FEE_OPENING_BALANCE_AS_OF_YEAR
      ? loadStudentFeeOpeningBalancesServer(supabase, ids)
      : Promise.resolve({ balances: {} as Record<string, number> });

  const [metricsResult, feeRows, recordsMap, yearStatesMap, openingResult, adjustmentResult, heldBackYearsResult, gradeHistoryResult, feeTierBundle] =
    await Promise.all([
      ids.length
        ? loadLessonMetricsBatchServer(supabase, ids, sheetYear)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? loadStudentMonthlyFeeRecordsInMonthRangeServer(supabase, {
            studentIds: ids,
            year: sheetYear,
            monthFrom: feeStartMonth,
            monthTo: currentMonth,
          })
        : Promise.resolve([] as FeeRecordBootstrapRow[]),
      ids.length ? loadLessonScheduleRecordsBatchServer(supabase, ids) : Promise.resolve({}),
      ids.length ? loadLessonYearStatesBatchServer(supabase, ids, sheetYear) : Promise.resolve({}),
      openingPromise,
      ids.length
        ? loadStudentFeeBalanceAdjustmentsServer(supabase, ids)
        : Promise.resolve({ adjustments: {} as Record<string, { amount: number; reason: string }> }),
      ids.length
        ? loadStudentHeldBackYearsServer(supabase, ids)
        : Promise.resolve({ byStudentId: {} as Record<string, number[]> }),
      ids.length
        ? loadStudentGradeHistoryServer(supabase, ids)
        : Promise.resolve({
            byStudentId: {} as Record<string, Record<string, FeeRecordGradeHistoryRow>>,
          }),
      loadStudentFeeTierSettingsAdmin(supabase),
    ]);

  if (metricsResult.error) throw new Error(metricsResult.error);

  const visibilityByStudentId: Record<string, FeeRecordStudentVisibility> = {};
  for (const id of ids) {
    visibilityByStudentId[id] = {
      periods: periodsById[id] ?? [],
    };
  }

  return {
    students,
    metricsRows: metricsResult.data ?? [],
    feeRows,
    recordsMap,
    yearStatesMap,
    openingResult,
    adjustmentResult,
    heldBackYearsResult,
    gradeHistoryResult,
    feeStartMonth,
    endMonthForPricing,
    visibilityByStudentId,
    feeTierBundle,
  };
}

export type FeeRecordBootstrapPayload = Awaited<ReturnType<typeof loadFeeRecordBootstrap>>;

async function loadFeeRecordBootstrapUncached(sheetYear: number, sheetMonth: number) {
  return loadFeeRecordBootstrap(getSupabaseAdmin(), { sheetYear, sheetMonth });
}

type FeeRecordBootstrapCachedCore = Omit<
  FeeRecordBootstrapPayload,
  "openingResult" | "adjustmentResult" | "heldBackYearsResult" | "gradeHistoryResult"
>;

/** Cached fee-sheet bootstrap (students + schedules + fee rows + tiers). */
export async function loadFeeRecordBootstrapCached(
  sheetYear: number,
  sheetMonth: number,
): Promise<FeeRecordBootstrapPayload> {
  const y = Math.floor(sheetYear);
  const m = Math.floor(sheetMonth);
  const cached = await unstable_cache(
    async (): Promise<FeeRecordBootstrapCachedCore> => {
      const payload = await loadFeeRecordBootstrapUncached(y, m);
      const { openingResult, adjustmentResult, heldBackYearsResult, gradeHistoryResult, ...rest } =
        payload;
      void openingResult;
      void adjustmentResult;
      void heldBackYearsResult;
      void gradeHistoryResult;
      return rest;
    },
    ["fee-record-bootstrap-v5", String(y), String(m)],
    { revalidate: 120, tags: [SCHEDULE_CACHE_TAG_FEE_RECORD] },
  )();

  const ids = cached.students.map((s) => s.id);
  const supabase = getSupabaseAdmin();
  const [openingResult, adjustmentResult, heldBackYearsResult, gradeHistoryResult] =
    await Promise.all([
      y === FEE_OPENING_BALANCE_AS_OF_YEAR
        ? loadStudentFeeOpeningBalancesServer(supabase, ids)
        : Promise.resolve({ balances: {} as Record<string, number> }),
      ids.length
        ? loadStudentFeeBalanceAdjustmentsServer(supabase, ids)
        : Promise.resolve({ adjustments: {} as Record<string, { amount: number; reason: string }> }),
      ids.length
        ? loadStudentHeldBackYearsServer(supabase, ids)
        : Promise.resolve({ byStudentId: {} as Record<string, number[]> }),
      ids.length
        ? loadStudentGradeHistoryServer(supabase, ids)
        : Promise.resolve({
            byStudentId: {} as Record<string, Record<string, FeeRecordGradeHistoryRow>>,
          }),
    ]);

  return {
    ...cached,
    openingResult,
    adjustmentResult,
    heldBackYearsResult,
    gradeHistoryResult,
  };
}

export async function upsertStudentFeeOpeningBalanceAdmin(
  studentId: string,
  openingBalance: number,
): Promise<{ ok: boolean; error?: string; tableMissing?: boolean }> {
  const value = Number(openingBalance) || 0;
  const { error } = await getSupabaseAdmin().from("student_fee_opening_balances").upsert(
    {
      student_id: studentId,
      as_of_year: FEE_OPENING_BALANCE_AS_OF_YEAR,
      as_of_month: FEE_OPENING_BALANCE_AS_OF_MONTH,
      opening_balance: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id,as_of_year,as_of_month" },
  );
  if (error) {
    return { ok: false, error: error.message, tableMissing: isMissingOpeningBalanceTableError(error.message) };
  }
  return { ok: true };
}

export async function upsertStudentFeeBalanceAdjustmentAdmin(
  studentId: string,
  adjustment: { amount: number; reason: string },
): Promise<{ ok: boolean; error?: string; tableMissing?: boolean }> {
  const amount = Number(adjustment.amount) || 0;
  const reason = String(adjustment.reason ?? "");
  const { error } = await getSupabaseAdmin().from("student_fee_balance_adjustments").upsert(
    {
      student_id: studentId,
      amount,
      reason,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );
  if (error) {
    return {
      ok: false,
      error: error.message,
      tableMissing: isMissingBalanceAdjustmentTableError(error.message),
    };
  }
  return { ok: true };
}

export type StudentLessonsBootstrapStudent = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  nickname_en: string | null;
  grade: string | null;
  school: string | null;
  textbook_publisher: string | null;
};

/** One pass for student lessons hub / year page (shared by API + RSC). */
export async function loadStudentLessonsBootstrap(
  supabase: SupabaseClient,
  studentId: string,
  year: number,
) {
  const [
    studentRes,
    examInfo,
    scheduleRecords,
    yearState,
    visibilityMode,
    inactivePeriods,
    roomSlotTutorRules,
    heldBackYearsResult,
    gradeHistoryResult,
  ] = await Promise.all([
      supabase
        .from("students")
        .select("id, name_zh, name_en, nickname_en, grade, school, textbook_publisher")
        .eq("id", studentId)
        .maybeSingle(),
      loadExamInfoServer(supabase, studentId),
      loadLessonScheduleRecordsServer(supabase, studentId),
      loadLessonYearStateServer(supabase, studentId, year),
      loadStudentVisibilityModeServer(supabase, studentId),
      loadStudentInactivePeriodsBatchServer(supabase, [studentId]),
      loadRoomSlotTutorRulesCached(),
      loadStudentHeldBackYearsServer(supabase, [studentId]),
      loadStudentGradeHistoryServer(supabase, [studentId]),
    ]);

  if (studentRes.error) throw new Error(studentRes.error.message);

  return {
    student: (studentRes.data ?? null) as StudentLessonsBootstrapStudent | null,
    examInfo,
    scheduleRecords,
    yearState,
    visibilityMode,
    inactivePeriods,
    roomSlotTutorRules,
    heldBackYears: heldBackYearsResult.byStudentId[studentId] ?? [],
    gradeHistory: gradeHistoryResult.byStudentId[studentId] ?? {},
  };
}

export type StudentLessonsBootstrapPayload = Awaited<ReturnType<typeof loadStudentLessonsBootstrap>>;
