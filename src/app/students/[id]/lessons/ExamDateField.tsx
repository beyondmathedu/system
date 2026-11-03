"use client";

import { useEffect, useRef, useState } from "react";
import ClientOnlyAfterMount from "@/components/ClientOnlyAfterMount";
import { loadExamInfo, saveExamInfo } from "@/lib/studentExamClient";
import {
  EMPTY_STUDENT_EXAM_INFO,
  listExamPapers,
  normalizeStudentExamInfo,
  type ExamPaperKey,
  type StudentExamInfo,
} from "@/lib/studentExamInfo";

function ExamDateFieldFallback({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-10 w-[170px] rounded-lg bg-slate-100" />
          <div className="h-10 w-[260px] rounded-lg bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

const STORAGE_KEY_PREFIX = "exam_info:";

function readStoredExamInfo(studentId: string): StudentExamInfo | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${studentId}`);
    if (!raw) return null;
    return normalizeStudentExamInfo(JSON.parse(raw) as Partial<StudentExamInfo>);
  } catch {
    return null;
  }
}

function writeStoredExamInfo(studentId: string, info: StudentExamInfo) {
  window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${studentId}`, JSON.stringify(info));
  // Keep legacy keys in sync for older clients.
  window.localStorage.setItem(`exam_date:${studentId}`, info.examDate);
  window.localStorage.setItem(`exam_content:${studentId}`, info.examContent);
}

export default function ExamDateField({
  studentId,
  initialValue,
  takesM1 = false,
  takesM2 = false,
}: {
  studentId: string;
  initialValue: StudentExamInfo | string;
  takesM1?: boolean;
  takesM2?: boolean;
}) {
  const initialInfo =
    typeof initialValue === "string"
      ? normalizeStudentExamInfo({ ...EMPTY_STUDENT_EXAM_INFO, examDate: initialValue })
      : normalizeStudentExamInfo(initialValue);
  const [value, setValue] = useState<StudentExamInfo>(initialInfo);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const papers = listExamPapers(value, { takesM1, takesM2 });

  const scheduleSave = (next: StudentExamInfo) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveExamInfo(studentId, next);
    }, 500);
  };

  const updatePaper = (key: ExamPaperKey, field: "examDate" | "examContent", nextValue: string) => {
    setValue((prev) => {
      const next = { ...prev };
      if (key === "compulsory") {
        if (field === "examDate") next.examDate = nextValue;
        else next.examContent = nextValue;
      } else if (key === "m1") {
        if (field === "examDate") next.m1ExamDate = nextValue;
        else next.m1ExamContent = nextValue;
      } else {
        if (field === "examDate") next.m2ExamDate = nextValue;
        else next.m2ExamContent = nextValue;
      }
      writeStoredExamInfo(studentId, next);
      scheduleSave(next);
      return next;
    });
  };

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const next =
      typeof initialValue === "string"
        ? normalizeStudentExamInfo({ ...EMPTY_STUDENT_EXAM_INFO, examDate: initialValue })
        : normalizeStudentExamInfo(initialValue);
    const timer = window.setTimeout(() => {
      setValue(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialValue]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const cloudValue = await loadExamInfo(studentId);
        const hasCloud =
          cloudValue.examDate ||
          cloudValue.examContent ||
          cloudValue.m1ExamDate ||
          cloudValue.m1ExamContent ||
          cloudValue.m2ExamDate ||
          cloudValue.m2ExamContent;
        if (hasCloud) {
          setValue(cloudValue);
          writeStoredExamInfo(studentId, cloudValue);
          return;
        }
        const stored = readStoredExamInfo(studentId);
        if (stored) {
          setValue(stored);
          return;
        }
        const legacyDate = window.localStorage.getItem(`exam_date:${studentId}`);
        const legacyContent = window.localStorage.getItem(`exam_content:${studentId}`);
        if (legacyDate || legacyContent) {
          const legacy = normalizeStudentExamInfo({
            ...EMPTY_STUDENT_EXAM_INFO,
            examDate: legacyDate ?? "",
            examContent: legacyContent ?? "",
          });
          setValue(legacy);
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studentId]);

  return (
    <div className="flex flex-col gap-3">
      <ClientOnlyAfterMount fallback={<ExamDateFieldFallback rows={papers.length} />}>
        <div className="flex flex-col gap-3">
          {papers.map((paper) => (
            <div key={paper.key} className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <span className="w-[170px] text-xs font-semibold tracking-wider text-slate-500">
                  {paper.dateLabel}
                </span>
                <span className="w-[260px] text-xs font-semibold tracking-wider text-slate-500">
                  {paper.contentLabel}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={paper.examDate}
                  aria-label={paper.dateLabel}
                  onChange={(e) => updatePaper(paper.key, "examDate", e.target.value)}
                  className="w-[170px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                />
                <input
                  type="text"
                  value={paper.examContent}
                  aria-label={paper.contentLabel}
                  onChange={(e) => updatePaper(paper.key, "examContent", e.target.value)}
                  placeholder="Exam content"
                  className="w-[260px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                />
              </div>
            </div>
          ))}
        </div>
      </ClientOnlyAfterMount>
    </div>
  );
}
