"use client";

import { notifyScheduleCachesStale } from "@/lib/scheduleCacheClient";
import { supabase } from "@/lib/supabase";

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
