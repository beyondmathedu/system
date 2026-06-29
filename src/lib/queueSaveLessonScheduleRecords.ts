"use client";

import {
  emitLessonSaveStatus,
  saveErrorMessage,
  withSaveRetries,
} from "@/lib/lessonSaveStatus";
import { saveLessonScheduleRecords } from "@/lib/studentLessonStorage";
import { flushScheduleCacheRevalidation } from "@/lib/scheduleCacheClient";

const SAVE_DEBOUNCE_MS = 400;
const pendingByStudentId = new Map<string, unknown[]>();
const timersByStudentId = new Map<string, number>();
const inFlightByStudentId = new Map<string, Promise<void>>();

async function flushStudent(studentId: string): Promise<void> {
  while (pendingByStudentId.has(studentId)) {
    const records = pendingByStudentId.get(studentId);
    if (!records) return;

    emitLessonSaveStatus({ kind: "records", studentId, status: "saving" });

    try {
      await withSaveRetries(() => saveLessonScheduleRecords(studentId, records));
      if (pendingByStudentId.get(studentId) === records) {
        pendingByStudentId.delete(studentId);
      }
      if (!pendingByStudentId.has(studentId)) {
        emitLessonSaveStatus({ kind: "records", studentId, status: "saved" });
        return;
      }
    } catch (error) {
      const message = saveErrorMessage(error);
      emitLessonSaveStatus({ kind: "records", studentId, status: "failed", message });
      throw error;
    }
  }
}

async function runFlush(studentId: string): Promise<void> {
  const run = () => flushStudent(studentId);
  const prev = inFlightByStudentId.get(studentId);
  const chain = prev ? prev.then(run, run) : run();
  inFlightByStudentId.set(
    studentId,
    chain.finally(() => {
      if (inFlightByStudentId.get(studentId) === chain) inFlightByStudentId.delete(studentId);
    }),
  );
  await chain;
}

export function queueSaveLessonScheduleRecords(studentId: string, records: unknown[]): void {
  if (typeof window === "undefined") return;
  pendingByStudentId.set(studentId, records);

  const existing = timersByStudentId.get(studentId);
  if (existing != null) window.clearTimeout(existing);

  timersByStudentId.set(
    studentId,
    window.setTimeout(() => {
      timersByStudentId.delete(studentId);
      void runFlush(studentId);
    }, SAVE_DEBOUNCE_MS),
  );
}

export function hasPendingLessonScheduleRecordsSaves(): boolean {
  return pendingByStudentId.size > 0 || timersByStudentId.size > 0 || inFlightByStudentId.size > 0;
}

export function retrySaveLessonScheduleRecords(studentId: string): void {
  if (typeof window === "undefined") return;
  if (!pendingByStudentId.has(studentId)) return;
  void runFlush(studentId);
}

export async function flushSaveLessonScheduleRecordsQueue(): Promise<void> {
  if (typeof window === "undefined") return;

  for (const timer of timersByStudentId.values()) window.clearTimeout(timer);
  timersByStudentId.clear();

  const ids = [...pendingByStudentId.keys()];
  await Promise.all(ids.map((id) => runFlush(id).catch(() => {})));
  flushScheduleCacheRevalidation();
}

if (typeof window !== "undefined") {
  const onLeave = () => {
    void flushSaveLessonScheduleRecordsQueue();
  };
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("beforeunload", onLeave);
}
