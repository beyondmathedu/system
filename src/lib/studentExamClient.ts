"use client";

import { notifyScheduleCachesStale } from "@/lib/scheduleCacheClient";
import { supabase } from "@/lib/supabase";

type ExamDateDbRow = {
  student_id?: string | null;
  exam_date?: string | null;
  exam_content?: string | null;
};

export type StudentExamInfo = {
  examDate: string;
  examContent: string;
};

function readExamDateRow(row: ExamDateDbRow | null | undefined): StudentExamInfo {
  return {
    examDate: String(row?.exam_date ?? ""),
    examContent: row?.exam_content ? String(row.exam_content) : "",
  };
}

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
