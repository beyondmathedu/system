"use client";

import { useEffect, useRef, useState } from "react";
import ClientOnlyAfterMount from "@/components/ClientOnlyAfterMount";
import { loadExamInfo, saveExamInfo } from "@/lib/studentLessonStorage";

function ExamDateFieldFallback() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="h-10 w-[170px] rounded-lg bg-slate-100" />
      <div className="h-10 w-[260px] rounded-lg bg-slate-100" />
    </div>
  );
}

const STORAGE_KEY_PREFIX = "exam_date:";
const CONTENT_STORAGE_KEY_PREFIX = "exam_content:";

export default function ExamDateField({
  studentId,
  initialValue,
}: {
  studentId: string;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [content, setContent] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = (examDate: string, examContent: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveExamInfo(studentId, { examDate, examContent });
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setValue(initialValue);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialValue]);

  useEffect(() => {
    const key = `${STORAGE_KEY_PREFIX}${studentId}`;
    const contentKey = `${CONTENT_STORAGE_KEY_PREFIX}${studentId}`;
    const timer = window.setTimeout(() => {
      void (async () => {
        const cloudValue = await loadExamInfo(studentId);
        if (cloudValue.examDate || cloudValue.examContent) {
          setValue(cloudValue.examDate);
          setContent(cloudValue.examContent);
          window.localStorage.setItem(key, cloudValue.examDate);
          window.localStorage.setItem(contentKey, cloudValue.examContent);
          return;
        }
        const storedDate = window.localStorage.getItem(key);
        const storedContent = window.localStorage.getItem(contentKey);
        if (storedDate) setValue(storedDate);
        if (storedContent) setContent(storedContent);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studentId]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <span className="w-[170px] text-xs font-semibold tracking-wider text-slate-500">Latest Exam Date</span>
        <span className="w-[260px] text-xs font-semibold tracking-wider text-slate-500">Exam Content</span>
      </div>
      <ClientOnlyAfterMount fallback={<ExamDateFieldFallback />}>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={value}
            onChange={(e) => {
              const nextDate = e.target.value;
              setValue(nextDate);
              window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${studentId}`, nextDate);
              scheduleSave(nextDate, content);
            }}
            className="w-[170px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          />
          <input
            type="text"
            value={content}
            onChange={(e) => {
              const nextContent = e.target.value;
              setContent(nextContent);
              window.localStorage.setItem(`${CONTENT_STORAGE_KEY_PREFIX}${studentId}`, nextContent);
              scheduleSave(value, nextContent);
            }}
            placeholder="Exam content"
            className="w-[260px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          />
        </div>
      </ClientOnlyAfterMount>
    </div>
  );
}
