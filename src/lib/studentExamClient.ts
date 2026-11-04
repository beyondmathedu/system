"use client";

import { notifyScheduleCachesStale } from "@/lib/scheduleCacheClient";
import { supabase } from "@/lib/supabase";
import {
  STUDENT_EXAM_SELECT,
  STUDENT_EXAM_SELECT_WITH_ID,
  normalizeStudentExamInfo,
  studentExamInfoFromDbRow,
  studentExamInfoToDbPayload,
  type StudentExamDbRow,
  type StudentExamInfo,
} from "@/lib/studentExamInfo";

export type { StudentExamInfo } from "@/lib/studentExamInfo";
export { EMPTY_STUDENT_EXAM_INFO } from "@/lib/studentExamInfo";

type ExamDateDbRow = StudentExamDbRow & {
  student_id?: string | null;
};

export async function loadExamInfo(studentId: string): Promise<StudentExamInfo> {
  const { data, error } = await supabase
    .from("student_exam_dates")
    .select(STUDENT_EXAM_SELECT)
    .eq("student_id", studentId)
    .maybeSingle();

  // Backward compatibility: older DB may not have newer exam columns yet.
  if (error) {
    const { data: fallback } = await supabase
      .from("student_exam_dates")
      .select("exam_date, exam_content")
      .eq("student_id", studentId)
      .maybeSingle();
    if (fallback) return studentExamInfoFromDbRow(fallback as StudentExamDbRow);
    const { data: legacy } = await supabase
      .from("student_exam_dates")
      .select("exam_date")
      .eq("student_id", studentId)
      .maybeSingle();
    return studentExamInfoFromDbRow(legacy as StudentExamDbRow | null);
  }

  return studentExamInfoFromDbRow(data as StudentExamDbRow | null);
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
    .select(STUDENT_EXAM_SELECT_WITH_ID)
    .in("student_id", studentIds);

  // Backward compatibility: older DB may not have newer exam columns yet.
  if (error) {
    const { data: mid } = await supabase
      .from("student_exam_dates")
      .select("student_id, exam_date, exam_content")
      .in("student_id", studentIds);
    if (mid) {
      for (const row of mid) {
        const typed = row as ExamDateDbRow;
        const sid = String(typed.student_id ?? "");
        if (!sid) continue;
        out[sid] = studentExamInfoFromDbRow(typed);
      }
      return out;
    }
    const { data: fallback } = await supabase
      .from("student_exam_dates")
      .select("student_id, exam_date")
      .in("student_id", studentIds);
    for (const row of fallback ?? []) {
      const typed = row as ExamDateDbRow;
      const sid = String(typed.student_id ?? "");
      if (!sid) continue;
      out[sid] = studentExamInfoFromDbRow(typed);
    }
    return out;
  }

  for (const row of data ?? []) {
    const typed = row as ExamDateDbRow;
    const sid = String(typed.student_id ?? "");
    if (!sid) continue;
    out[sid] = studentExamInfoFromDbRow(typed);
  }
  return out;
}

export async function saveExamInfo(studentId: string, examInfo: StudentExamInfo) {
  const payload = studentExamInfoToDbPayload(examInfo);
  const { error } = await supabase.from("student_exam_dates").upsert(
    {
      student_id: studentId,
      ...payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );

  // Backward compatibility: older DB may not have M1/M2 or exam_content yet.
  if (error) {
    const { error: midError } = await supabase.from("student_exam_dates").upsert(
      {
        student_id: studentId,
        exam_date: payload.exam_date,
        exam_content: payload.exam_content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    );
    if (midError) {
      await supabase.from("student_exam_dates").upsert(
        {
          student_id: studentId,
          exam_date: payload.exam_date,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id" },
      );
    }
  }
  notifyScheduleCachesStale();
}

export async function saveExamDate(studentId: string, examDate: string) {
  const current = await loadExamInfo(studentId);
  await saveExamInfo(studentId, normalizeStudentExamInfo({ ...current, examDate }));
}
