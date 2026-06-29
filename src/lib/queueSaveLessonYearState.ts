"use client";

import {
  emitLessonSaveStatus,
  saveErrorMessage,
  withSaveRetries,
} from "@/lib/lessonSaveStatus";
import { saveLessonYearStatePatch } from "@/lib/studentLessonStorage";
import {
  lessonYearStateFieldsUnchanged,
  patchFromLessonYearState,
} from "@/lib/lessonYearStatePatchCore";
import {
  ALL_LESSON_YEAR_STATE_FIELDS,
  type LessonYearStateField,
  type StudentLesson2026State,
} from "@/lib/lessonYearStateShared";
import { flushScheduleCacheRevalidation } from "@/lib/scheduleCacheClient";

const SAVE_DEBOUNCE_MS = 400;

type PendingSave = {
  state: StudentLesson2026State;
  dirty: Set<LessonYearStateField>;
  dirtyAttendanceKeys: Set<string>;
};

const pendingByKey = new Map<string, PendingSave>();
const lastSavedByKey = new Map<string, StudentLesson2026State>();
const timersByKey = new Map<string, number>();
const inFlightByKey = new Map<string, Promise<void>>();

function queueKey(studentId: string, year: number) {
  return `${studentId}:${year}`;
}

function mergeDirtyFields(
  existing: Set<LessonYearStateField> | undefined,
  dirtyFields: readonly LessonYearStateField[] | undefined,
): Set<LessonYearStateField> {
  const dirty = new Set(existing ?? []);
  if (dirtyFields?.length) {
    for (const field of dirtyFields) dirty.add(field);
    return dirty;
  }
  for (const field of ALL_LESSON_YEAR_STATE_FIELDS) dirty.add(field);
  return dirty;
}

function mergeDirtyAttendanceKeys(
  existing: Set<string> | undefined,
  keys: readonly string[] | undefined,
): Set<string> {
  const merged = new Set(existing ?? []);
  if (keys?.length) {
    for (const key of keys) {
      if (key) merged.add(key);
    }
  }
  return merged;
}

function patchFromPending(pending: PendingSave): Partial<StudentLesson2026State> {
  return patchFromLessonYearState(pending.state, pending.dirty);
}

function mergeLastSaved(key: string, state: StudentLesson2026State, fields: readonly LessonYearStateField[]) {
  const prev = lastSavedByKey.get(key) ?? { ...state };
  const next: StudentLesson2026State = { ...prev };
  for (const field of fields) {
    next[field] = state[field] as never;
  }
  lastSavedByKey.set(key, next);
}

export function hasPendingLessonYearStateSaves(): boolean {
  return pendingByKey.size > 0 || timersByKey.size > 0 || inFlightByKey.size > 0;
}

async function flushKey(key: string, studentId: string, year: number): Promise<void> {
  while (pendingByKey.has(key)) {
    const pending = pendingByKey.get(key);
    if (!pending) return;

    const dirtyFields = [...pending.dirty];
    const snapshot = pending.state;
    const lastSaved = lastSavedByKey.get(key);

    if (lessonYearStateFieldsUnchanged(snapshot, dirtyFields, lastSaved)) {
      pendingByKey.delete(key);
      emitLessonSaveStatus({ kind: "year", studentId, year, status: "saved" });
      return;
    }

    emitLessonSaveStatus({ kind: "year", studentId, year, status: "saving" });

    const attendanceOnly =
      dirtyFields.length === 1 && dirtyFields[0] === "attendance";
    const attendanceKeys =
      attendanceOnly && pending.dirtyAttendanceKeys.size
        ? [...pending.dirtyAttendanceKeys]
        : undefined;

    try {
      await withSaveRetries(() =>
        saveLessonYearStatePatch(studentId, year, patchFromPending(pending), dirtyFields, {
          attendanceKeys,
          lastSavedAttendance: lastSaved?.attendance,
        }),
      );

      mergeLastSaved(key, snapshot, dirtyFields);

      const stillPending = pendingByKey.get(key);
      if (stillPending?.state === snapshot) {
        pendingByKey.delete(key);
      }
      if (!pendingByKey.has(key)) {
        emitLessonSaveStatus({ kind: "year", studentId, year, status: "saved" });
        return;
      }
    } catch (error) {
      const message = saveErrorMessage(error);
      emitLessonSaveStatus({ kind: "year", studentId, year, status: "failed", message });
      throw error;
    }
  }
}

async function runFlush(key: string, studentId: string, year: number): Promise<void> {
  const run = () => flushKey(key, studentId, year);
  const prev = inFlightByKey.get(key);
  const chain = prev ? prev.then(run, run) : run();
  inFlightByKey.set(
    key,
    chain.finally(() => {
      if (inFlightByKey.get(key) === chain) inFlightByKey.delete(key);
    }),
  );
  await chain;
}

/** Debounced cloud save; pass `dirtyFields` so only changed JSON columns are upserted. */
export function queueSaveLessonYearState(
  studentId: string,
  year: number,
  state: StudentLesson2026State,
  dirtyFields?: readonly LessonYearStateField[],
  dirtyAttendanceKeys?: readonly string[],
): void {
  if (typeof window === "undefined") return;
  const key = queueKey(studentId, year);
  const existing = pendingByKey.get(key);
  pendingByKey.set(key, {
    state,
    dirty: mergeDirtyFields(existing?.dirty, dirtyFields),
    dirtyAttendanceKeys: mergeDirtyAttendanceKeys(existing?.dirtyAttendanceKeys, dirtyAttendanceKeys),
  });

  const existingTimer = timersByKey.get(key);
  if (existingTimer != null) window.clearTimeout(existingTimer);

  timersByKey.set(
    key,
    window.setTimeout(() => {
      timersByKey.delete(key);
      void runFlush(key, studentId, year);
    }, SAVE_DEBOUNCE_MS),
  );
}

/** Retry the latest pending/failed year-state save for one student. */
export function retrySaveLessonYearState(studentId: string, year: number): void {
  if (typeof window === "undefined") return;
  const key = queueKey(studentId, year);
  if (!pendingByKey.has(key)) return;
  void runFlush(key, studentId, year);
}

/** Await all pending year-state saves (navigation / tab close). */
export async function flushSaveLessonYearStateQueue(): Promise<void> {
  if (typeof window === "undefined") return;

  for (const timer of timersByKey.values()) window.clearTimeout(timer);
  timersByKey.clear();

  const keys = [...pendingByKey.keys()];
  await Promise.all(
    keys.map((key) => {
      const [studentId, yearRaw] = key.split(":");
      const year = Number(yearRaw);
      if (!studentId || !Number.isFinite(year)) return Promise.resolve();
      return runFlush(key, studentId, year).catch(() => {});
    }),
  );

  flushScheduleCacheRevalidation();
}

if (typeof window !== "undefined") {
  const onLeave = () => {
    void flushSaveLessonYearStateQueue();
  };
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("beforeunload", onLeave);
}
