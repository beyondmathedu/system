"use client";

import { useEffect, useState } from "react";
import { loadExamDate, saveExamDate } from "@/lib/studentLessonStorage";

const STORAGE_KEY_PREFIX = "exam_date:";

export default function ExamDateField({
  studentId,
  initialValue,
}: {
  studentId: string;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setValue(initialValue);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialValue]);

  useEffect(() => {
    const key = `${STORAGE_KEY_PREFIX}${studentId}`;
    const timer = window.setTimeout(() => {
      void (async () => {
        const cloudValue = await loadExamDate(studentId);
        if (cloudValue) {
          setValue(cloudValue);
          window.localStorage.setItem(key, cloudValue);
          return;
        }
        const stored = window.localStorage.getItem(key);
        if (stored) setValue(stored);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studentId]);

  return (
    <input
      suppressHydrationWarning
      type="date"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${studentId}`, next);
        void saveExamDate(studentId, next);
      }}
      className="w-[170px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
    />
  );
}

