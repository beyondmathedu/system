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
  FEE_RECORD_SELECT_BASE,
  FEE_RECORD_SELECT_WITH_SPLIT_REMARKS,
  isMissingFeeRecordColumnError,
  normalizeFeeRecordRow,
} from "@/lib/studentMonthlyFeeRecordsCompat";
import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";
import { supabase } from "@/lib/supabase";
import { canonicalScheduleRoomLabel } from "@/lib/dayTimetableShared";
import {
  attendanceRecordDelta,
  buildAttendancePatchFromKeys,
  buildLessonYearStateUpsertRow,
  isMissingAttendancePatchRpcError,
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

export async function loadLessonScheduleRecords(studentId: string) {
  const { data } = await supabase
    .from("student_lesson_records")
    .select("records")
    .eq("student_id", studentId)
    .maybeSingle();

  if (!data?.records || !Array.isArray(data.records)) return [];
  return data.records;
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

export async function saveLessonScheduleRecords(studentId: string, records: unknown[]) {
  const normalized = normalizeLessonRecordsForStorage(records);
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
};

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
  /** HKD flat per lesson; when set, overrides tiered FIFO for that month. */
  lesson_unit_price: number | null;
  /** Optional F1–F6; when null, infer from students.grade + Sept 1 promotions. */
  fee_pricing_grade: string | null;
  remarks: string;
  makeup_remarks: string;
  balance_due_remarks: string;
  send_fee: boolean;
};

export type StudentVisibilityMode = {
  student_id: string;
  mode: "active" | "inactive";
  effective_date: string;
  /** Optional expected return to Active (YYYY-MM-DD). */
  reactivate_date: string | null;
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
    rows = await loadWithSelect(FEE_RECORD_SELECT_BASE);
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
  sendFee: boolean;
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
    sendFee,
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
    send_fee: sendFee,
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

export async function loadStudentVisibilityMode(studentId: string): Promise<StudentVisibilityMode> {
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
}) {
  const { studentId, mode, effectiveDate, reactivateDate } = input;
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
