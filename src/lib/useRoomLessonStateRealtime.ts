"use client";

import { useEffect, useMemo, useRef } from "react";
import type { RoomScheduleRow } from "@/lib/roomScheduleAggregate";
import {
  parseLessonYearStateFromRealtimeRow,
  patchRoomRowsFromLessonState,
} from "@/lib/roomScheduleLiveSync";
import type { StudentLesson2026State } from "@/lib/studentLessonStorage";
import { supabase } from "@/lib/supabase";

type Options = {
  year: number;
  rows: RoomScheduleRow[];
  stateCache: React.MutableRefObject<Map<string, StudentLesson2026State>>;
  initialNoteByRowKey: React.MutableRefObject<Map<string, string>>;
  latestNoteByRowKeyRef: React.MutableRefObject<Map<string, string>>;
  setLocalRows: React.Dispatch<React.SetStateAction<RoomScheduleRow[]>>;
  savingRowKeyRef: React.MutableRefObject<string | null>;
  savingLessonSummaryRowKeyRef: React.MutableRefObject<string | null>;
  lessonSummaryPendingRef: React.MutableRefObject<Map<string, string>>;
};

function slotKeyFromRow(r: Pick<RoomScheduleRow, "dateIso" | "time" | "room">) {
  return `${r.dateIso}__${r.time}__${r.room}`.toLowerCase();
}

/** 訂閱 Supabase Realtime：其他裝置／帳號改動會即時反映在本頁課表 */
export function useRoomLessonStateRealtime({
  year,
  rows,
  stateCache,
  initialNoteByRowKey,
  latestNoteByRowKeyRef,
  setLocalRows,
  savingRowKeyRef,
  savingLessonSummaryRowKeyRef,
  lessonSummaryPendingRef,
}: Options) {
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const studentIdsKey = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.studentId)))
        .filter(Boolean)
        .sort()
        .join(","),
    [rows],
  );

  useEffect(() => {
    if (!studentIdsKey) return;

    const studentIdSet = new Set(studentIdsKey.split(","));

    const applyRemote = (raw: Record<string, unknown>) => {
      const parsed = parseLessonYearStateFromRealtimeRow(raw);
      if (!parsed || !studentIdSet.has(parsed.studentId)) return;

      stateCache.current.set(parsed.studentId, parsed.state);

      const skipRowKeys = new Set<string>();
      const savingKey = savingRowKeyRef.current;
      const savingSummaryKey = savingLessonSummaryRowKeyRef.current;
      if (savingKey) {
        for (const row of rowsRef.current) {
          if (row.rowKey === savingKey || slotKeyFromRow(row) === savingKey) {
            skipRowKeys.add(row.rowKey);
          }
        }
      }
      if (savingSummaryKey) skipRowKeys.add(savingSummaryKey);
      for (const row of rowsRef.current) {
        if (lessonSummaryPendingRef.current.has(row.rowKey)) {
          skipRowKeys.add(row.rowKey);
        }
      }

      setLocalRows((prev) => {
        const next = patchRoomRowsFromLessonState(prev, parsed.studentId, parsed.state, {
          skipRowKeys,
        });
        for (const row of next) {
          if (row.studentId !== parsed.studentId || skipRowKeys.has(row.rowKey)) continue;
          initialNoteByRowKey.current.set(row.rowKey, row.note);
          latestNoteByRowKeyRef.current.set(row.rowKey, row.note);
        }
        return next;
      });
    };

    const channel = supabase
      .channel(`room-lesson-state-y${year}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "student_lessons_year_state",
          filter: `year=eq.${year}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const raw = payload.new as Record<string, unknown> | null;
          if (!raw) return;
          applyRemote(raw);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [
    year,
    studentIdsKey,
    stateCache,
    initialNoteByRowKey,
    latestNoteByRowKeyRef,
    setLocalRows,
    savingRowKeyRef,
    savingLessonSummaryRowKeyRef,
    lessonSummaryPendingRef,
  ]);
}
