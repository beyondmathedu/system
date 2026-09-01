"use client";

import { notifyScheduleCachesStale } from "@/lib/scheduleCacheClient";
import { normalizeOptionalIsoDate } from "@/lib/studentVisibility";
import {
  DEFAULT_LESSON_YEAR_STATE,
  parseLessonYearStateDbRow,
  type LessonYearStateField,
  type StudentLesson2026State,
  ALL_LESSON_YEAR_STATE_FIELDS,
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
import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";
import { supabase } from "@/lib/supabase";
import { canonicalScheduleRoomLabel } from "@/lib/dayTimetableShared";
import {
  repairCollidingScheduleRuleIds,
  type LessonScheduleSlotRule,
} from "@/lib/lessonScheduleVersions";
import {
  attendanceRecordDelta,
  buildAttendancePatchFromKeys,
  buildLessonYearStateUpsertRow,
  buildOverridesPatchFromKeys,
  isMissingAttendancePatchRpcError,
  isMissingOverridesPatchRpcError,
} from "@/lib/lessonYearStatePatchCore";

export type { StudentLesson2026State } from "@/lib/lessonYearStateShared";
export { parseLessonYearStateDbRow } from "@/lib/lessonYearStateShared";

/** Supabase row shapes used before generated types exist for every column. */
type ExamDateDbRow = {
  student_id?: string | null;
  exam_date?: string | null;
  exam_content?: string | null;
};

type LessonRecordsDbRow = {
  student_id?: string | null;
  records?: unknown[] | null;
};

type VisibilityModeDbRow = {
  student_id?: string | null;
  mode?: string | null;
  effective_date?: string | null;
  reactivate_date?: string | null;
};

type VisibilityPeriodDbRow = {
  id?: number | null;
  student_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  note?: string | null;
};

function readExamDateRow(row: ExamDateDbRow | null | undefined) {
  return {
    examDate: String(row?.exam_date ?? ""),
    examContent: row?.exam_content ? String(row.exam_content) : "",
  };
}

export type StudentExamInfo = {
  examDate: string;
  examContent: string;
};

const DEFAULT_2026_STATE = DEFAULT_LESSON_YEAR_STATE;

export async function loadExamInfo(studentId: string): Promise<StudentExamInfo> {
  const { data, error } = await supabase
    .from("student_exam_dates")
    .select("exam_date, exam_content")
    .eq("student_id", studentId)
    .maybeSingle();

  // Backward compatibility: older DB may not have exam_content yet.
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

  return readExamDateRow(data as ExamDateDbRow | null);
}

export async function loadExamDate(studentId: string) {
  const info = await loadExamInfo(studentId);
  return info.examDate;
}

export async function loadExamDatesBatch(studentIds: string[]) {
  if (!studentIds.length) return {} as Record<string, string>;
  const { data } = await supabase
    .from("student_exam_dates")
    .select("student_id, exam_date")
    .in("student_id", studentIds);
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    const typed = row as ExamDateDbRow;
    out[String(typed.student_id ?? "")] = String(typed.exam_date ?? "");
  }
  return out;
}

export async function loadExamInfoBatch(studentIds: string[]) {
  if (!studentIds.length) return {} as Record<string, StudentExamInfo>;
  const out: Record<string, StudentExamInfo> = {};
  const { data, error } = await supabase
    .from("student_exam_dates")
    .select("student_id, exam_date, exam_content")
    .in("student_id", studentIds);

  // Backward compatibility: older DB may not have exam_content yet.
  if (error) {
    const { data: fallback } = await supabase
      .from("student_exam_dates")
      .select("student_id, exam_date")
      .in("student_id", studentIds);
    for (const row of fallback ?? []) {
      const typed = row as ExamDateDbRow;
      const sid = String(typed.student_id ?? "");
      if (!sid) continue;
      out[sid] = {
        examDate: String(typed.exam_date ?? ""),
        examContent: "",
      };
    }
    return out;
  }

  for (const row of data ?? []) {
    const typed = row as ExamDateDbRow;
    const sid = String(typed.student_id ?? "");
    if (!sid) continue;
    out[sid] = readExamDateRow(typed);
  }
  return out;
}

export async function saveExamInfo(studentId: string, examInfo: StudentExamInfo) {
  const { examDate, examContent } = examInfo;
  const { error } = await supabase.from("student_exam_dates").upsert(
    {
      student_id: studentId,
      exam_date: examDate,
      exam_content: examContent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );

  // Backward compatibility: older DB may not have exam_content yet.
  if (error) {
    await supabase.from("student_exam_dates").upsert(
      { student_id: studentId, exam_date: examDate, updated_at: new Date().toISOString() },
      { onConflict: "student_id" },
    );
  }
  notifyScheduleCachesStale();
}

export async function saveExamDate(studentId: string, examDate: string) {
  const current = await loadExamInfo(studentId);
  await saveExamInfo(studentId, { examDate, examContent: current.examContent });
}

/** Daily / Regular timetable 當日 Remarks（學生 + 日期 YYYY-MM-DD） */
export async function loadTimetableDayRemarksForStudent(
  studentId: string,
  startIso: string,
  endIso: string,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("student_timetable_day_remarks")
    .select("date_iso, remarks")
    .eq("student_id", studentId)
    .gte("date_iso", startIso)
    .lte("date_iso", endIso);

  if (error) {
    if (/student_timetable_day_remarks/i.test(error.message) && /does not exist/i.test(error.message)) {
      return {};
    }
    throw new Error(error.message);
  }

  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    const iso = String((row as { date_iso?: string }).date_iso ?? "").trim();
    if (iso) out[iso] = String((row as { remarks?: string | null }).remarks ?? "");
  }
  return out;
}

export async function upsertTimetableDayRemark(studentId: string, dateIso: string, remarks: string) {
  await supabase.from("student_timetable_day_remarks").upsert(
    {
      student_id: studentId,
      date_iso: dateIso,
      remarks,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id,date_iso" },
  );
  notifyScheduleCachesStale();
}

export async function deleteTimetableDayRemark(studentId: string, dateIso: string) {
  await supabase
    .from("student_timetable_day_remarks")
    .delete()
    .eq("student_id", studentId)
    .eq("date_iso", dateIso);
  notifyScheduleCachesStale();
}

/** Permanent admin remark (all timetable days for this student). */
export async function upsertTimetablePermanentRemark(studentId: string, remarks: string) {
  const { error } = await supabase
    .from("students")
    .update({ timetable_permanent_remark: remarks })
    .eq("id", studentId);
  if (error) {
    if (/timetable_permanent_remark/i.test(error.message) && /does not exist/i.test(error.message)) {
      throw new Error("請先在 Supabase 執行 migration 20260902_student_timetable_permanent_remark.sql");
    }
    throw new Error(error.message);
  }
  notifyScheduleCachesStale();
}

export async function loadLessonScheduleRecords(studentId: string) {
  const { data } = await supabase
    .from("student_lesson_records")
    .select("records")
    .eq("student_id", studentId)
    .maybeSingle();

  if (!data?.records || !Array.isArray(data.records)) return [];
  const { records, repairedCount } = normalizeAndRepairLessonScheduleRecords(
    data.records as LessonScheduleSlotRule[],
  );
  if (repairedCount > 0) {
    void saveLessonScheduleRecords(studentId, records);
  }
  return records;
}

export async function loadLessonScheduleRecordsBatch(studentIds: string[]) {
  if (!studentIds.length) return {} as Record<string, unknown[]>;
  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    query: (chunk) =>
      supabase.from("student_lesson_records").select("student_id, records").in("student_id", chunk),
  });
  if (error) throw new Error(error);
  const out: Record<string, unknown[]> = {};
  for (const row of data) {
    const typed = row as LessonRecordsDbRow;
    out[String(typed.student_id ?? "")] = Array.isArray(typed.records)
      ? typed.records
      : [];
  }
  return out;
}

function normalizeLessonRecordsForStorage(records: unknown[]): unknown[] {
  return records.map((item) => {
    if (!item || typeof item !== "object") return item;
    const row = item as Record<string, unknown>;
    if (typeof row.room !== "string") return item;
    const room = canonicalScheduleRoomLabel(row.room);
    return room === row.room.trim() ? item : { ...row, room };
  });
}

export function normalizeAndRepairLessonScheduleRecords<T extends LessonScheduleSlotRule>(
  records: T[],
): { records: T[]; repairedCount: number } {
  const normalized = normalizeLessonRecordsForStorage(records) as T[];
  const { rules, repairedCount } = repairCollidingScheduleRuleIds(normalized);
  return { records: rules, repairedCount };
}

export async function saveLessonScheduleRecords(studentId: string, records: unknown[]) {
  const { records: normalized } = normalizeAndRepairLessonScheduleRecords(
    normalizeLessonRecordsForStorage(records) as LessonScheduleSlotRule[],
  );
  const { error } = await supabase.from("student_lesson_records").upsert(
    { student_id: studentId, records: normalized, updated_at: new Date().toISOString() },
    { onConflict: "student_id" },
  );
  if (error) throw new Error(error.message);
  notifyScheduleCachesStale();
}

async function loadLegacy2026StatesBatchClient(studentIds: string[]) {
  if (!studentIds.length) return {} as Record<string, StudentLesson2026State>;
  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    query: (chunk) =>
      supabase.from("student_lessons_2026_state").select(LEGACY_2026_STATE_SELECT).in("student_id", chunk),
  });
  if (error) throw new Error(error);
  return parseLegacy2026StateRows(data as Array<Record<string, unknown>>);
}

/** @deprecated Use `loadLessonYearState(studentId, LEGACY_LESSON_STATE_YEAR)` */
export async function loadLesson2026State(studentId: string) {
  return loadLessonYearState(studentId, LEGACY_LESSON_STATE_YEAR);
}

/** @deprecated Use `saveLessonYearState(studentId, LEGACY_LESSON_STATE_YEAR, state)` */
export async function saveLesson2026State(studentId: string, state: StudentLesson2026State) {
  await saveLessonYearState(studentId, LEGACY_LESSON_STATE_YEAR, state);
}

export async function loadLessonYearState(studentId: string, year: number) {
  const { data } = await supabase
    .from("student_lessons_year_state")
    .select("attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
    .eq("student_id", studentId)
    .eq("year", year)
    .maybeSingle();

  const yearState = data
    ? parseLessonYearStateDbRow(data as Record<string, unknown>)
    : { ...DEFAULT_2026_STATE };

  if (year !== LEGACY_LESSON_STATE_YEAR) return yearState;

  const legacyBatch = await loadLegacy2026StatesBatchClient([studentId]);
  return mergeYearStateWithLegacyFallback(yearState, legacyBatch[studentId], year);
}

export async function loadLessonYearStatesBatch(studentIds: string[], year: number) {
  if (!studentIds.length) return {} as Record<string, StudentLesson2026State>;
  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
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

  const legacyStates = await loadLegacy2026StatesBatchClient(needLegacy);
  return mergeYearStatesBatchWithLegacyFallback(studentIds, year, yearStates, legacyStates);
}

export type SaveLessonYearStatePatchOptions = {
  /** Skip aggregate cache revalidation (rare; default revalidates after save). */
  skipScheduleCacheRevalidate?: boolean;
  /** When set, attendance is merged via RPC using only these keys (smallest payload). */
  attendanceKeys?: readonly string[];
  /** Baseline attendance for delta fallback when RPC is unavailable. */
  lastSavedAttendance?: Record<string, boolean>;
  /** When set, overrides are merged via RPC using only these date keys. */
  overrideDateKeys?: readonly string[];
};

export async function patchLessonYearOverrides(
  studentId: string,
  year: number,
  patch: Record<string, unknown>,
  options?: Pick<SaveLessonYearStatePatchOptions, "skipScheduleCacheRevalidate">,
) {
  if (!Object.keys(patch).length) return;

  const { error } = await supabase.rpc("patch_lesson_year_overrides", {
    p_student_id: studentId,
    p_year: year,
    p_patch: patch,
  });

  if (error && isMissingOverridesPatchRpcError(error.message)) {
    throw new Error(`OVERRIDES_RPC_MISSING:${error.message}`);
  }
  if (error) throw new Error(error.message);

  if (!options?.skipScheduleCacheRevalidate) {
    notifyScheduleCachesStale();
  }
}

export async function patchLessonYearAttendance(
  studentId: string,
  year: number,
  patch: Record<string, boolean>,
  options?: Pick<SaveLessonYearStatePatchOptions, "skipScheduleCacheRevalidate">,
) {
  if (!Object.keys(patch).length) return;

  const { error } = await supabase.rpc("patch_lesson_year_attendance", {
    p_student_id: studentId,
    p_year: year,
    p_patch: patch,
  });

  if (error && isMissingAttendancePatchRpcError(error.message)) {
    throw new Error(`ATTENDANCE_RPC_MISSING:${error.message}`);
  }
  if (error) throw new Error(error.message);

  if (!options?.skipScheduleCacheRevalidate) {
    notifyScheduleCachesStale();
  }
}

export async function saveLessonYearStatePatch(
  studentId: string,
  year: number,
  patch: Partial<StudentLesson2026State>,
  fields: readonly LessonYearStateField[],
  options?: SaveLessonYearStatePatchOptions,
) {
  const attendanceOnly = fields.length === 1 && fields[0] === "attendance";
  const overridesOnly = fields.length === 1 && fields[0] === "overrides";

  if (attendanceOnly && patch.attendance) {
    const attendancePatch = options?.attendanceKeys?.length
      ? buildAttendancePatchFromKeys(patch.attendance, options.attendanceKeys)
      : attendanceRecordDelta(patch.attendance, options?.lastSavedAttendance);

    if (!Object.keys(attendancePatch).length) return;

    try {
      await patchLessonYearAttendance(studentId, year, attendancePatch, {
        skipScheduleCacheRevalidate: options?.skipScheduleCacheRevalidate,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith("ATTENDANCE_RPC_MISSING:")) throw error;
    }
  }

  if (overridesOnly && patch.overrides) {
    const overridesRecord = patch.overrides as Record<string, unknown>;
    const overridesPatch = options?.overrideDateKeys?.length
      ? buildOverridesPatchFromKeys(overridesRecord, options.overrideDateKeys)
      : overridesRecord;

    if (!Object.keys(overridesPatch).length) return;

    try {
      await patchLessonYearOverrides(studentId, year, overridesPatch, {
        skipScheduleCacheRevalidate: options?.skipScheduleCacheRevalidate,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith("OVERRIDES_RPC_MISSING:")) throw error;

      const current = await loadLessonYearState(studentId, year);
      const merged: Record<string, unknown> = { ...(current.overrides ?? {}) };
      for (const [dateIso, entry] of Object.entries(overridesPatch)) {
        const prev = merged[dateIso];
        if (prev && typeof prev === "object" && !Array.isArray(prev) && entry && typeof entry === "object" && !Array.isArray(entry)) {
          merged[dateIso] = { ...(prev as Record<string, unknown>), ...(entry as Record<string, unknown>) };
        } else {
          merged[dateIso] = entry;
        }
      }
      patch = { ...patch, overrides: merged };
    }
  }

  const payload = buildLessonYearStateUpsertRow(studentId, year, patch, fields);
  if (!payload) return;

  const { error } = await supabase
    .from("student_lessons_year_state")
    .upsert(payload, { onConflict: "student_id,year" });
  if (error) throw new Error(error.message);

  if (!options?.skipScheduleCacheRevalidate) {
    notifyScheduleCachesStale();
  }
}

export async function saveLessonYearState(
  studentId: string,
  year: number,
  state: StudentLesson2026State,
) {
  await saveLessonYearStatePatch(studentId, year, state, ALL_LESSON_YEAR_STATE_FIELDS);
}

export async function saveLessonYearMetrics(
  studentId: string,
  year: number,
  remedialCount: number,
  currentMonthAbsentCount: number,
) {
  const payload = {
    student_id: studentId,
    year,
    remedial_count: remedialCount,
    current_month_absent_count: currentMonthAbsentCount,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("student_lessons_year_metrics")
    .upsert(payload, { onConflict: "student_id,year" });
  if (error && isMissingLessonMetricsTableError(error.message) && year === LEGACY_LESSON_STATE_YEAR) {
    await supabase.from("student_lessons_2026_metrics").upsert(
      {
        student_id: studentId,
        remedial_count: remedialCount,
        current_month_absent_count: currentMonthAbsentCount,
        updated_at: payload.updated_at,
      },
      { onConflict: "student_id" },
    );
    return;
  }
  if (error) throw new Error(error.message);
}

/** @deprecated Use `saveLessonYearMetrics(studentId, LEGACY_LESSON_STATE_YEAR, ...)` */
export async function saveLesson2026Metrics(
  studentId: string,
  remedialCount: number,
  currentMonthAbsentCount: number,
) {
  await saveLessonYearMetrics(
    studentId,
    LEGACY_LESSON_STATE_YEAR,
    remedialCount,
    currentMonthAbsentCount,
  );
}

export type StudentMonthlyFeeRecord = {
  student_id: string;
  year: number;
  month: number;
  submitted_amount: number;
  /** Zoho receipt quantity; Tuition Paid hint e.g. $820(4堂). */
  submitted_lesson_count: number | null;
  /** HKD flat per lesson; when set, overrides tiered FIFO for that month. */
  lesson_unit_price: number | null;
  /** Optional F1–F6; when null, infer from students.grade + Sept 1 promotions. */
  fee_pricing_grade: string | null;
  remarks: string;
  makeup_remarks: string;
  balance_due_remarks: string;
};

export type StudentVisibilityMode = {
  student_id: string;
  mode: "active" | "inactive";
  effective_date: string;
  /** Optional expected return to Active (YYYY-MM-DD). */
  reactivate_date: string | null;
};

export type StudentInactivePeriod = {
  id?: number;
  student_id: string;
  start_date: string;
  /** First day the student becomes Active again (exclusive end), or null for indefinite pause. */
  end_date: string | null;
  note: string;
};

/** One round-trip for submit/history rows across inclusive month range. */
export async function loadStudentMonthlyFeeRecordsInMonthRange(params: {
  studentIds: string[];
  year: number;
  monthFrom: number;
  monthTo: number;
}): Promise<StudentMonthlyFeeRecord[]> {
  const { studentIds, year, monthFrom, monthTo } = params;
  if (!studentIds.length || monthTo < monthFrom) return [];

  async function loadWithSelect(select: string) {
    const { data, error } = await fetchRowsInChunks<Record<string, unknown>>({
      ids: studentIds,
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

  return rows.map((row) => normalizeFeeRecordRow(row)) as StudentMonthlyFeeRecord[];
}

export async function loadStudentMonthlyFeeRecords(params: {
  studentIds: string[];
  year: number;
  month: number;
}) {
  const { studentIds, year, month } = params;
  return loadStudentMonthlyFeeRecordsInMonthRange({ studentIds, year, monthFrom: month, monthTo: month });
}

function normalizeFeePricingGradeForDb(raw: string): string | null {
  const s = String(raw ?? "").trim().replace(/\s/g, "").toUpperCase();
  const m = /^F\.?([1-6])$/.exec(s);
  return m ? `F${m[1]}` : null;
}

export async function upsertStudentMonthlyFeeRecord(input: {
  studentId: string;
  year: number;
  month: number;
  submittedAmount: number;
  lessonUnitPrice: number;
  feePricingGrade: string;
  remarks: string;
  makeupRemarks: string;
  balanceDueRemarks: string;
}) {
  const {
    studentId,
    year,
    month,
    submittedAmount,
    lessonUnitPrice,
    feePricingGrade,
    remarks,
    makeupRemarks,
    balanceDueRemarks,
  } = input;
  const unit = Number(lessonUnitPrice) || 0;
  const normalizedFeeGrade = normalizeFeePricingGradeForDb(feePricingGrade);
  const basePayload = {
    student_id: studentId,
    year,
    month,
    submitted_amount: submittedAmount,
    lesson_unit_price: unit > 0 ? unit : null,
    fee_pricing_grade: normalizedFeeGrade,
    remarks,
    updated_at: new Date().toISOString(),
  };
  const fullPayload = {
    ...basePayload,
    makeup_remarks: makeupRemarks,
    balance_due_remarks: balanceDueRemarks,
  };
  let { error } = await supabase
    .from("student_monthly_fee_records")
    .upsert(fullPayload, { onConflict: "student_id,year,month" });
  if (error && isMissingFeeRecordColumnError(error.message)) {
    ({ error } = await supabase
      .from("student_monthly_fee_records")
      .upsert(basePayload, { onConflict: "student_id,year,month" }));
  }
  if (error) throw error;
}

function hkTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function normalizePeriodRow(row: VisibilityPeriodDbRow): StudentInactivePeriod | null {
  const sid = String(row.student_id ?? "").trim();
  const start = normalizeOptionalIsoDate(row.start_date);
  if (!sid || !start) return null;
  return {
    id: Number(row.id) > 0 ? Number(row.id) : undefined,
    student_id: sid,
    start_date: start,
    end_date: normalizeOptionalIsoDate(row.end_date),
    note: String(row.note ?? ""),
  };
}

export async function loadStudentInactivePeriods(studentId: string): Promise<StudentInactivePeriod[]> {
  const { data, error } = await supabase
    .from("student_visibility_periods")
    .select("id, student_id, start_date, end_date, note")
    .eq("student_id", studentId)
    .order("start_date", { ascending: true });

  // Backward compatibility: older DB may not have this table yet.
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("student_visibility_periods") && (msg.includes("does not exist") || msg.includes("not found"))) {
      // Inline legacy read (avoid recursion).
      const legacy = await (async () => {
        const { data, error } = await supabase
          .from("student_visibility_modes")
          .select("student_id, mode, effective_date, reactivate_date")
          .eq("student_id", studentId)
          .maybeSingle();
        if (error && /reactivate_date/i.test(error.message)) {
          const fallback = await supabase
            .from("student_visibility_modes")
            .select("student_id, mode, effective_date")
            .eq("student_id", studentId)
            .maybeSingle();
          const row = fallback.data as VisibilityModeDbRow | null;
          const rawMode = String(row?.mode ?? "active").toLowerCase();
          return {
            mode: rawMode === "inactive" ? "inactive" : "active",
            effective_date: String(row?.effective_date ?? new Date().toISOString().slice(0, 10)),
            reactivate_date: null as string | null,
          };
        }
        const row = data as VisibilityModeDbRow | null;
        const rawMode = String(row?.mode ?? "active").toLowerCase();
        return {
          mode: rawMode === "inactive" ? "inactive" : "active",
          effective_date: String(row?.effective_date ?? new Date().toISOString().slice(0, 10)),
          reactivate_date: normalizeOptionalIsoDate(row?.reactivate_date),
        };
      })();

      if (legacy.mode !== "inactive") return [];
      return [
        {
          student_id: studentId,
          start_date: String(legacy.effective_date),
          end_date: normalizeOptionalIsoDate(legacy.reactivate_date),
          note: "fallback: student_visibility_modes",
        },
      ];
    }
    throw error;
  }

  return (data ?? [])
    .map((r) => normalizePeriodRow(r as VisibilityPeriodDbRow))
    .filter((x): x is StudentInactivePeriod => Boolean(x));
}

export async function appendStudentInactivePeriod(input: {
  studentId: string;
  startDate: string;
  endDate?: string | null;
  note?: string;
}) {
  const startDate = normalizeOptionalIsoDate(input.startDate) ?? String(input.startDate ?? "").trim();
  const endDate = normalizeOptionalIsoDate(input.endDate ?? "");
  const note = String(input.note ?? "");

  let duplicateQuery = supabase
    .from("student_visibility_periods")
    .select("id")
    .eq("student_id", input.studentId)
    .eq("start_date", startDate)
    .eq("note", note)
    .limit(1);
  duplicateQuery = endDate
    ? duplicateQuery.eq("end_date", endDate)
    : duplicateQuery.is("end_date", null);

  const { data: existing, error: dupErr } = await duplicateQuery;
  if (dupErr) throw dupErr;
  if (existing?.length) return;

  const payload = {
    student_id: input.studentId,
    start_date: startDate,
    end_date: endDate,
    note,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("student_visibility_periods").insert(payload);
  if (error) throw error;
}

export async function closeLatestOpenStudentInactivePeriod(input: { studentId: string; endDate: string }) {
  const { data, error } = await supabase
    .from("student_visibility_periods")
    .select("id, start_date")
    .eq("student_id", input.studentId)
    .is("end_date", null)
    .order("start_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as VisibilityPeriodDbRow | undefined;
  const id = Number(row?.id ?? 0);
  if (!Number.isFinite(id) || id <= 0) return;
  const { error: upErr } = await supabase
    .from("student_visibility_periods")
    .update({ end_date: input.endDate, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) throw upErr;
}

/** Set or clear Expected return (first active day) on a specific inactive-history row. */
export async function updateStudentInactivePeriodEndDate(input: {
  id: number;
  endDate: string | null;
}) {
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Missing inactive period id");
  }
  const endDate = normalizeOptionalIsoDate(input.endDate ?? "");
  const { error } = await supabase
    .from("student_visibility_periods")
    .update({ end_date: endDate, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  notifyScheduleCachesStale();
}

/** Delete one inactive-history row (student_visibility_periods). */
export async function deleteStudentInactivePeriod(input: { id: number }) {
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Missing inactive period id");
  }
  const { error } = await supabase.from("student_visibility_periods").delete().eq("id", id);
  if (error) throw error;
  notifyScheduleCachesStale();
}

export async function loadStudentVisibilityMode(studentId: string): Promise<StudentVisibilityMode> {
  // Prefer new periods model; fall back to legacy single-row mode.
  try {
    const periods = await loadStudentInactivePeriods(studentId);
    const today = hkTodayIso();
    const activePeriod = periods
      .filter((p) => p.start_date <= today && (!p.end_date || today < p.end_date))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];

    if (activePeriod) {
      return {
        student_id: studentId,
        mode: "inactive",
        effective_date: activePeriod.start_date,
        reactivate_date: normalizeOptionalIsoDate(activePeriod.end_date),
      };
    }
    return {
      student_id: studentId,
      mode: "active",
      effective_date: today,
      reactivate_date: null,
    };
  } catch {
    // ignore and fall through to legacy loader
  }

  const { data, error } = await supabase
    .from("student_visibility_modes")
    .select("student_id, mode, effective_date, reactivate_date")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error && /reactivate_date/i.test(error.message)) {
    const fallback = await supabase
      .from("student_visibility_modes")
      .select("student_id, mode, effective_date")
      .eq("student_id", studentId)
      .maybeSingle();
    if (!fallback.data) {
      return {
        student_id: studentId,
        mode: "active",
        effective_date: new Date().toISOString().slice(0, 10),
        reactivate_date: null,
      };
    }
    const row = fallback.data as VisibilityModeDbRow;
    const rawMode = String(row.mode ?? "active").toLowerCase();
    return {
      student_id: String(row.student_id ?? studentId),
      mode: rawMode === "inactive" ? "inactive" : "active",
      effective_date: String(row.effective_date ?? new Date().toISOString().slice(0, 10)),
      reactivate_date: null,
    };
  }

  if (!data) {
    return {
      student_id: studentId,
      mode: "active",
      effective_date: new Date().toISOString().slice(0, 10),
      reactivate_date: null,
    };
  }

  const row = data as VisibilityModeDbRow;
  const rawMode = String(row.mode ?? "active").toLowerCase();
  return {
    student_id: String(row.student_id ?? studentId),
    mode: rawMode === "inactive" ? "inactive" : "active",
    effective_date: String(row.effective_date ?? new Date().toISOString().slice(0, 10)),
    reactivate_date: normalizeOptionalIsoDate(row.reactivate_date),
  };
}

export async function saveStudentVisibilityMode(input: {
  studentId: string;
  mode: "active" | "inactive";
  effectiveDate: string;
  reactivateDate?: string | null;
  note?: string | null;
}) {
  const { studentId, mode, effectiveDate, reactivateDate, note } = input;
  // New canonical storage: append/close inactive periods.
  // - Inactive: add a new period (keeps history)
  // - Active: close the latest open-ended period (if any) using effectiveDate as the first active day
  try {
    if (mode === "inactive") {
      await appendStudentInactivePeriod({
        studentId,
        startDate: effectiveDate,
        endDate: normalizeOptionalIsoDate(reactivateDate ?? ""),
        note: note ?? undefined,
      });
    } else {
      await closeLatestOpenStudentInactivePeriod({ studentId, endDate: effectiveDate });
    }
  } catch {
    // keep legacy write path below for older DBs; caller still gets caches invalidated.
  }
  const payload = {
    student_id: studentId,
    mode,
    effective_date: effectiveDate,
    reactivate_date:
      mode === "inactive" ? normalizeOptionalIsoDate(reactivateDate ?? "") : null,
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase.from("student_visibility_modes").upsert(payload, { onConflict: "student_id" });
  if (error && /reactivate_date/i.test(error.message)) {
    ({ error } = await supabase.from("student_visibility_modes").upsert(
      {
        student_id: studentId,
        mode,
        effective_date: effectiveDate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    ));
  }
  if (error) throw error;
  notifyScheduleCachesStale();
}
