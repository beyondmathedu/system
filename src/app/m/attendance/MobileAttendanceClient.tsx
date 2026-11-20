"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  flushSaveLessonYearStateQueue,
  queueSaveLessonYearState,
} from "@/lib/queueSaveLessonYearState";
import { attendanceAfterRegularToggle } from "@/lib/lessonScheduleVersions";
import {
  upsertLessonSlotOrDateOverride,
  type LessonDayOverride,
} from "@/lib/lessonDayOverrides";
import {
  DEFAULT_LESSON_YEAR_STATE,
  type StudentLesson2026State,
} from "@/lib/lessonYearStateShared";
import { notifyScheduleCachesStale } from "@/lib/scheduleCacheClient";
import type { MobileAttendanceRow } from "@/lib/mobileAttendanceData.server";
import type { YearLessonState } from "@/lib/yearScheduleCore";

type Props = {
  dateIso: string;
  year: number;
  initialRows: MobileAttendanceRow[];
  initialYearStates: Record<string, YearLessonState>;
  loadError: string | null;
};

function toClientState(raw: YearLessonState | undefined): StudentLesson2026State {
  if (!raw) return { ...DEFAULT_LESSON_YEAR_STATE };
  return {
    attendance: raw.attendance ?? {},
    hiddenDates: raw.hiddenDates ?? {},
    overrides: (raw.overrides ?? {}) as Record<string, LessonDayOverride>,
    rescheduleEntries: raw.rescheduleEntries ?? [],
    extraEntries: raw.extraEntries ?? [],
  };
}

export default function MobileAttendanceClient({
  dateIso,
  year,
  initialRows,
  initialYearStates,
  loadError,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  const [saveError, setSaveError] = useState("");
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const stateCache = useRef(new Map<string, StudentLesson2026State>());
  const summaryTimers = useRef(new Map<string, number>());

  useEffect(() => {
    setRows(initialRows);
    const next = new Map<string, StudentLesson2026State>();
    for (const [sid, st] of Object.entries(initialYearStates)) {
      next.set(sid, toClientState(st));
    }
    stateCache.current = next;
  }, [initialRows, initialYearStates]);

  useEffect(() => {
    return () => {
      for (const t of summaryTimers.current.values()) window.clearTimeout(t);
      summaryTimers.current.clear();
    };
  }, []);

  const markSaving = useCallback((studentId: string, on: boolean) => {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(studentId);
      else next.delete(studentId);
      return next;
    });
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, MobileAttendanceRow[]>();
    for (const r of rows) {
      const key = `${r.time} · ${r.room}`;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [rows]);

  function onToggle(row: MobileAttendanceRow, checked: boolean) {
    setSaveError("");
    markSaving(row.studentId, true);
    setRows((prev) => prev.map((r) => (r.rowKey === row.rowKey ? { ...r, attended: checked } : r)));
    const current = stateCache.current.get(row.studentId) ?? { ...DEFAULT_LESSON_YEAR_STATE };
    const nextState: StudentLesson2026State = {
      ...current,
      attendance: attendanceAfterRegularToggle(current.attendance, row.attendanceKey, checked),
    };
    stateCache.current.set(row.studentId, nextState);
    queueSaveLessonYearState(row.studentId, year, nextState, ["attendance"], [row.attendanceKey]);
    void flushSaveLessonYearStateQueue()
      .then(() => notifyScheduleCachesStale())
      .catch((e) => setSaveError(e instanceof Error ? e.message : "Save failed"))
      .finally(() => markSaving(row.studentId, false));
  }

  function onSummaryChange(row: MobileAttendanceRow, nextNote: string) {
    setRows((prev) => prev.map((r) => (r.rowKey === row.rowKey ? { ...r, note: nextNote } : r)));
    const old = summaryTimers.current.get(row.rowKey);
    if (old) window.clearTimeout(old);
    const handle = window.setTimeout(() => {
      summaryTimers.current.delete(row.rowKey);
      setSaveError("");
      markSaving(row.studentId, true);
      const current = stateCache.current.get(row.studentId) ?? { ...DEFAULT_LESSON_YEAR_STATE };
      const overrides =
        current.overrides && typeof current.overrides === "object"
          ? (current.overrides as Record<string, LessonDayOverride>)
          : {};
      const nextState: StudentLesson2026State = {
        ...current,
        overrides: upsertLessonSlotOrDateOverride(overrides, {
          dateIso: row.dateIso,
          scheduleRuleId: row.scheduleRuleId,
          patch: { lessonSummary: nextNote.trim() },
        }),
      };
      stateCache.current.set(row.studentId, nextState);
      queueSaveLessonYearState(row.studentId, year, nextState, ["overrides"]);
      void flushSaveLessonYearStateQueue()
        .then(() => notifyScheduleCachesStale())
        .catch((e) => setSaveError(e instanceof Error ? e.message : "Save failed"))
        .finally(() => markSaving(row.studentId, false));
    }, 500);
    summaryTimers.current.set(row.rowKey, handle);
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-3 pb-10 pt-4">
      <header className="rounded-2xl bg-[#1d76c2] px-4 py-4 text-white shadow-sm">
        <p className="text-xs font-medium text-blue-100">Phone · Today</p>
        <h1 className="text-xl font-bold tracking-tight">{dateIso} Attendance</h1>
        <p className="mt-1 text-sm text-blue-100">Your rooms · tick attendance & lesson summary</p>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/m/attendance"
          className="rounded-lg bg-white px-3 py-2 font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200"
        >
          Refresh
        </Link>
        <Link
          href="/daily-time-table"
          className="rounded-lg px-3 py-2 font-medium text-slate-600 ring-1 ring-slate-200"
        >
          Full site
        </Link>
      </div>

      {loadError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {loadError}
        </p>
      ) : null}
      {saveError ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {saveError}
        </p>
      ) : null}

      {grouped.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">
          No lessons in your rooms today.
        </p>
      ) : (
        grouped.map(([slot, slotRows]) => (
          <section key={slot} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">
              {slot}
            </div>
            <ul className="divide-y divide-slate-100">
              {slotRows.map((r) => {
                const busy = savingIds.has(r.studentId);
                return (
                  <li key={r.rowKey} className="px-3 py-3">
                    <div className="flex items-start gap-3">
                      <label className="mt-1 flex shrink-0 items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-6 w-6 rounded border-slate-300 text-[#1d76c2]"
                          checked={r.attended}
                          disabled={busy}
                          onChange={(e) => onToggle(r, e.target.checked)}
                          aria-label={`Attendance ${r.studentName}`}
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-semibold text-slate-900">{r.studentName}</p>
                        <p className="text-xs text-slate-500">
                          {r.grade || "—"} · {r.lessonType}
                          {busy ? " · saving…" : ""}
                        </p>
                        <label className="mt-2 block text-xs font-medium text-slate-600">
                          Lesson summary
                          <textarea
                            className="mt-1 min-h-[4.5rem] w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                            value={r.note}
                            disabled={busy}
                            onChange={(e) => onSummaryChange(r, e.target.value)}
                            rows={3}
                          />
                        </label>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
