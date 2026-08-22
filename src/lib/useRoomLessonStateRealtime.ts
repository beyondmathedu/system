"use client";

import { useEffect, useMemo, useRef } from "react";
import type { RoomScheduleRow } from "@/lib/roomScheduleAggregate";
import {
  patchRoomRowsFromLessonState,
} from "@/lib/roomScheduleLiveSync";
import {
  loadLessonYearStatesBatch,
  type StudentLesson2026State,
} from "@/lib/studentLessonStorage";

/** Poll only when tab is visible; avoids Supabase Realtime WAL load. */
const ROOM_STATE_POLL_MS = 60_000;

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

/** Light sync for room schedule: poll page students instead of Realtime subscribe. */
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

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const studentIds = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.studentId)))
        .filter(Boolean)
        .sort(),
    [rows],
  );

  const studentIdsKey = studentIds.join(",");

  useEffect(() => {
    if (!studentIdsKey) return;

    const ids = studentIdsKey.split(",").filter(Boolean);
    let cancelled = false;
    const timer = window.setInterval(() => void poll(), ROOM_STATE_POLL_MS);

    const applyRemoteState = (studentId: string, state: StudentLesson2026State) => {
      stateCache.current.set(studentId, state);

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
        const next = patchRoomRowsFromLessonState(prev, studentId, state, {
          skipRowKeys,
        });
        for (const row of next) {
          if (row.studentId !== studentId || skipRowKeys.has(row.rowKey)) continue;
          initialNoteByRowKey.current.set(row.rowKey, row.note);
          latestNoteByRowKeyRef.current.set(row.rowKey, row.note);
        }
        return next;
      });
    };

    const poll = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (savingRowKeyRef.current || savingLessonSummaryRowKeyRef.current) return;

      try {
        const batch = await loadLessonYearStatesBatch(ids, year);
        if (cancelled) return;
        for (const id of ids) {
          const state = batch[id];
          if (state) applyRemoteState(id, state);
        }
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
