import type { SupabaseClient } from "@supabase/supabase-js";
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
  FEE_RECORD_SELECT_BASE,
  FEE_RECORD_SELECT_WITH_SPLIT_REMARKS,
  FEE_RECORD_SELECT_WITH_SPLIT_REMARKS_LEGACY,
  FEE_RECORD_SELECT_LEGACY_NO_PAID_COUNT,
  isMissingFeeRecordColumnError,
  normalizeFeeRecordRow,
} from "@/lib/studentMonthlyFeeRecordsCompat";
import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";
import {
  buildStudentVisibilityMaps,
  normalizeOptionalIsoDate,
} from "@/lib/studentVisibility";

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

export async function loadStudentVisibilityModeServer(
  supabase: SupabaseClient,
  studentId: string,
): Promise<StudentVisibilityModeServer> {
  const defaultDate = new Date().toISOString().slice(0, 10);
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

export type FeeRecordStudentVisibility = {
  manualInactiveEffective: string | null;
  reactivateDate: string | null;
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
    mode?: string;
    effective_date?: string;
    reactivate_date?: string | null;
  }> = [];
  if (allIds.length) {
    const vis = await fetchRowsInChunks({
      ids: allIds,
      concurrency: 8,
      query: (chunk) =>
        supabase
          .from("student_visibility_modes")
          .select("student_id, mode, effective_date, reactivate_date")
          .in("student_id", chunk),
    });
    if (vis.error) throw new Error(vis.error);
    visibilityRows = vis.data;
  }

  const { inactiveEffectiveById, reactivateDateById } = buildStudentVisibilityMaps(visibilityRows ?? []);

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

  const [metricsResult, feeRows, recordsMap, yearStatesMap, openingResult] = await Promise.all([
    ids.length ? loadLessonMetricsBatchServer(supabase, ids, sheetYear) : Promise.resolve({ data: [], error: null }),
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
  ]);

  if (metricsResult.error) throw new Error(metricsResult.error);

  const visibilityByStudentId: Record<string, FeeRecordStudentVisibility> = {};
  for (const id of ids) {
    visibilityByStudentId[id] = {
      manualInactiveEffective: inactiveEffectiveById[id] ?? null,
      reactivateDate: reactivateDateById[id] ?? null,
    };
  }

  return {
    students,
    metricsRows: metricsResult.data ?? [],
    feeRows,
    recordsMap,
    yearStatesMap,
    openingResult,
    feeStartMonth,
    endMonthForPricing,
    visibilityByStudentId,
  };
}
