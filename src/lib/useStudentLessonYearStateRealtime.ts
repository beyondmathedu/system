"use client";

import { useEffect, useRef } from "react";
import { parseLessonYearStateFromRealtimeRow } from "@/lib/roomScheduleLiveSync";
import type { StudentLesson2026State } from "@/lib/studentLessonStorage";
import { supabase } from "@/lib/supabase";

/** Supabase Realtime for one student's year state (room-page tutor edits, other devices). */
export function useStudentLessonYearStateRealtime(
  studentId: string,
  year: number,
  onRemoteState: (state: StudentLesson2026State) => void,
) {
  const onRemoteRef = useRef(onRemoteState);
  onRemoteRef.current = onRemoteState;

  useEffect(() => {
    if (!studentId) return;

    const channel = supabase
      .channel(`student-lesson-state-${studentId}-y${year}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "student_lessons_year_state",
          filter: `student_id=eq.${studentId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const raw = payload.new as Record<string, unknown> | null;
          if (!raw || Number(raw.year) !== year) return;
          // REPLICA IDENTITY DEFAULT may omit JSON columns — skip incomplete rows
          // so we don't wipe local extras/reschedules with empty defaults.
          const hasJson =
            "attendance" in raw ||
            "hidden_dates" in raw ||
            "overrides" in raw ||
            "reschedule_entries" in raw ||
            "extra_entries" in raw;
          if (!hasJson) return;
          const parsed = parseLessonYearStateFromRealtimeRow(raw);
          if (parsed) onRemoteRef.current(parsed.state);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [studentId, year]);
}
