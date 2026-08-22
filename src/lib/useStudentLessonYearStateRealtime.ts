"use client";

import { useEffect, useRef } from "react";
import { hasPendingLessonYearStateSaves } from "@/lib/queueSaveLessonYearState";
import type { StudentLesson2026State } from "@/lib/studentLessonStorage";
import { loadLessonYearState } from "@/lib/studentLessonStorage";

/** Poll only when tab is visible; avoids Supabase Realtime WAL load. */
const STUDENT_STATE_POLL_MS = 60_000;

/** Light sync for student lesson page: poll year state instead of Realtime subscribe. */
export function useStudentLessonYearStateRealtime(
  studentId: string,
  year: number,
  onRemoteState: (state: StudentLesson2026State) => void,
) {
  const onRemoteRef = useRef(onRemoteState);

  useEffect(() => {
    onRemoteRef.current = onRemoteState;
  }, [onRemoteState]);

  useEffect(() => {
    if (!studentId) return;

    let cancelled = false;
    const timer = window.setInterval(() => void poll(), STUDENT_STATE_POLL_MS);

    const poll = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (hasPendingLessonYearStateSaves()) return;

      try {
        const state = await loadLessonYearState(studentId, year);
        if (cancelled || hasPendingLessonYearStateSaves()) return;
        onRemoteRef.current(state);
      } catch {
        // Ignore transient network errors; next poll will retry.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [studentId, year]);
}
