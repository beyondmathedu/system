"use client";

import { supabase } from "@/lib/supabase";

export type StudentLesson2026State = {
  attendance: Record<string, boolean>;
  hiddenDates: Record<string, boolean>;
  overrides: Record<string, unknown>;
  rescheduleEntries: unknown[];
  extraEntries: unknown[];
};

const DEFAULT_2026_STATE: StudentLesson2026State = {
  attendance: {},
  hiddenDates: {},
  overrides: {},
  rescheduleEntries: [],
  extraEntries: [],
};

export async function loadExamDate(studentId: string) {
  const { data } = await supabase
    .from("student_exam_dates")
    .select("exam_date")
    .eq("student_id", studentId)
    .maybeSingle();
  return (data?.exam_date as string | null) ?? "";
}

export async function loadExamDatesBatch(studentIds: string[]) {
  if (!studentIds.length) return {} as Record<string, string>;
  const { data } = await supabase
    .from("student_exam_dates")
    .select("student_id, exam_date")
    .in("student_id", studentIds);
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    out[String((row as any).student_id)] = String((row as any).exam_date ?? "");
  }
  return out;
}

export async function saveExamDate(studentId: string, examDate: string) {
  await supabase.from("student_exam_dates").upsert(
    { student_id: studentId, exam_date: examDate, updated_at: new Date().toISOString() },
    { onConflict: "student_id" },
  );
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
}

export async function deleteTimetableDayRemark(studentId: string, dateIso: string) {
  await supabase
    .from("student_timetable_day_remarks")
    .delete()
    .eq("student_id", studentId)
    .eq("date_iso", dateIso);
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
  const { data } = await supabase
    .from("student_lesson_records")
    .select("student_id, records")
    .in("student_id", studentIds);
  const out: Record<string, unknown[]> = {};
  for (const row of data ?? []) {
    out[String((row as any).student_id)] = Array.isArray((row as any).records)
      ? ((row as any).records as unknown[])
      : [];
  }
  return out;
}

export async function saveLessonScheduleRecords(studentId: string, records: unknown[]) {
  await supabase.from("student_lesson_records").upsert(
    { student_id: studentId, records, updated_at: new Date().toISOString() },
    { onConflict: "student_id" },
  );
}

export async function loadLesson2026State(studentId: string) {
  const { data } = await supabase
    .from("student_lessons_2026_state")
    .select("attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
    .eq("student_id", studentId)
    .maybeSingle();

  if (!data) return DEFAULT_2026_STATE;

  return {
    attendance:
      data.attendance && typeof data.attendance === "object"
        ? (data.attendance as Record<string, boolean>)
        : {},
    hiddenDates:
      data.hidden_dates && typeof data.hidden_dates === "object"
        ? (data.hidden_dates as Record<string, boolean>)
        : {},
    overrides:
      data.overrides && typeof data.overrides === "object"
        ? (data.overrides as Record<string, unknown>)
        : {},
    rescheduleEntries: Array.isArray(data.reschedule_entries) ? data.reschedule_entries : [],
    extraEntries: Array.isArray(data.extra_entries) ? data.extra_entries : [],
  };
}

export async function saveLesson2026State(studentId: string, state: StudentLesson2026State) {
  await supabase.from("student_lessons_2026_state").upsert(
    {
      student_id: studentId,
      attendance: state.attendance,
      hidden_dates: state.hiddenDates,
      overrides: state.overrides,
      reschedule_entries: state.rescheduleEntries,
      extra_entries: state.extraEntries,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );
}

export async function loadLessonYearState(studentId: string, year: number) {
  const { data } = await supabase
    .from("student_lessons_year_state")
    .select("attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
    .eq("student_id", studentId)
    .eq("year", year)
    .maybeSingle();

  if (!data) return DEFAULT_2026_STATE;

  return {
    attendance:
      data.attendance && typeof data.attendance === "object"
        ? (data.attendance as Record<string, boolean>)
        : {},
    hiddenDates:
      data.hidden_dates && typeof data.hidden_dates === "object"
        ? (data.hidden_dates as Record<string, boolean>)
        : {},
    overrides:
      data.overrides && typeof data.overrides === "object"
        ? (data.overrides as Record<string, unknown>)
        : {},
    rescheduleEntries: Array.isArray(data.reschedule_entries) ? data.reschedule_entries : [],
    extraEntries: Array.isArray(data.extra_entries) ? data.extra_entries : [],
  };
}

export async function loadLessonYearStatesBatch(studentIds: string[], year: number) {
  if (!studentIds.length) return {} as Record<string, StudentLesson2026State>;
  const { data } = await supabase
    .from("student_lessons_year_state")
    .select("student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
    .eq("year", year)
    .in("student_id", studentIds);
  const out: Record<string, StudentLesson2026State> = {};
  for (const row of data ?? []) {
    out[String((row as any).student_id)] = {
      attendance:
        (row as any).attendance && typeof (row as any).attendance === "object"
          ? ((row as any).attendance as Record<string, boolean>)
          : {},
      hiddenDates:
        (row as any).hidden_dates && typeof (row as any).hidden_dates === "object"
          ? ((row as any).hidden_dates as Record<string, boolean>)
          : {},
      overrides:
        (row as any).overrides && typeof (row as any).overrides === "object"
          ? ((row as any).overrides as Record<string, unknown>)
          : {},
      rescheduleEntries: Array.isArray((row as any).reschedule_entries)
        ? ((row as any).reschedule_entries as unknown[])
        : [],
      extraEntries: Array.isArray((row as any).extra_entries)
        ? ((row as any).extra_entries as unknown[])
        : [],
    };
  }
  return out;
}

export async function saveLessonYearState(
  studentId: string,
  year: number,
  state: StudentLesson2026State,
) {
  await supabase.from("student_lessons_year_state").upsert(
    {
      student_id: studentId,
      year,
      attendance: state.attendance,
      hidden_dates: state.hiddenDates,
      overrides: state.overrides,
      reschedule_entries: state.rescheduleEntries,
      extra_entries: state.extraEntries,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id,year" },
  );
}

export async function saveLesson2026Metrics(
  studentId: string,
  remedialCount: number,
  currentMonthAbsentCount: number,
) {
  await supabase.from("student_lessons_2026_metrics").upsert(
    {
      student_id: studentId,
      remedial_count: remedialCount,
      current_month_absent_count: currentMonthAbsentCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );
}

export type StudentMonthlyFeeRecord = {
  student_id: string;
  year: number;
  month: number;
  submitted_amount: number;
  remarks: string;
  send_fee: boolean;
};

export type StudentVisibilityMode = {
  student_id: string;
  mode: "active" | "inactive";
  effective_date: string;
};

export async function loadStudentMonthlyFeeRecords(params: {
  studentIds: string[];
  year: number;
  month: number;
}) {
  const { studentIds, year, month } = params;
  if (!studentIds.length) return [];
  const { data } = await supabase
    .from("student_monthly_fee_records")
    .select("student_id, year, month, submitted_amount, remarks, send_fee")
    .eq("year", year)
    .eq("month", month)
    .in("student_id", studentIds);
  return (data ?? []) as unknown as StudentMonthlyFeeRecord[];
}

export async function upsertStudentMonthlyFeeRecord(input: {
  studentId: string;
  year: number;
  month: number;
  submittedAmount: number;
  remarks: string;
  sendFee: boolean;
}) {
  const { studentId, year, month, submittedAmount, remarks, sendFee } = input;
  await supabase.from("student_monthly_fee_records").upsert(
    {
      student_id: studentId,
      year,
      month,
      submitted_amount: submittedAmount,
      remarks,
      send_fee: sendFee,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id,year,month" },
  );
}

export async function loadStudentVisibilityMode(studentId: string): Promise<StudentVisibilityMode> {
  const { data } = await supabase
    .from("student_visibility_modes")
    .select("student_id, mode, effective_date")
    .eq("student_id", studentId)
    .maybeSingle();

  if (!data) {
    return {
      student_id: studentId,
      mode: "active",
      effective_date: new Date().toISOString().slice(0, 10),
    };
  }

  const rawMode = String((data as any).mode ?? "active").toLowerCase();
  return {
    student_id: String((data as any).student_id ?? studentId),
    mode: rawMode === "inactive" ? "inactive" : "active",
    effective_date: String((data as any).effective_date ?? new Date().toISOString().slice(0, 10)),
  };
}

export async function saveStudentVisibilityMode(input: {
  studentId: string;
  mode: "active" | "inactive";
  effectiveDate: string;
}) {
  const { studentId, mode, effectiveDate } = input;
  await supabase.from("student_visibility_modes").upsert(
    {
      student_id: studentId,
      mode,
      effective_date: effectiveDate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );
}
