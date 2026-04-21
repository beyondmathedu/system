"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { RoomScheduleRow } from "@/lib/roomScheduleAggregate";
import { normalizeStudentId } from "@/lib/studentId";
import {
  loadExamDatesBatch,
  loadLessonYearState,
  loadLessonYearStatesBatch,
  saveLessonYearState,
  type StudentLesson2026State,
} from "@/lib/studentLessonStorage";
import { loadTutorVisibility } from "@/lib/tutorVisibility";
import { formatGradeDisplay } from "@/lib/grade";

type Props = {
  rows: RoomScheduleRow[];
  year: number;
  canOpenStudentLink?: boolean;
  readOnly?: boolean;
};

type SortDirection = "asc" | "desc";
type RoomScheduleSortKey =
  | "dateIso"
  | "weekday"
  | "sortTime"
  | "room"
  | "tutor"
  | "note"
  | "school"
  | "examDate"
  | "lessonType";
type RoomScheduleSortConfig = { key: RoomScheduleSortKey; direction: SortDirection } | null;

export default function RoomScheduleTable({
  rows,
  year,
  canOpenStudentLink = true,
  readOnly = false,
}: Props) {
  const [localRows, setLocalRows] = useState(rows);
  const [sortConfig, setSortConfig] = useState<RoomScheduleSortConfig>(null);
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null);
  const [savingLessonSummaryRowKey, setSavingLessonSummaryRowKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [teacherOptions, setTeacherOptions] = useState<string[]>([]);
  const [inactiveTutorNames, setInactiveTutorNames] = useState<Set<string>>(new Set());
  const [examDatesByStudentId, setExamDatesByStudentId] = useState<Record<string, string>>({});
  const stateCache = useRef(new Map<string, StudentLesson2026State>());
  const initialNoteByRowKey = useRef(new Map<string, string>());
  const latestNoteByRowKeyRef = useRef(new Map<string, string>());
  const lessonSummarySaveTimersRef = useRef(new Map<string, number>());
  const lessonSummaryPendingRef = useRef(new Map<string, string>());
  const lessonSummaryInFlightRef = useRef(new Set<string>());
  const examDateCache = useRef(new Map<string, string>());

  function formatExamDateDisplay(iso: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return `${Number(m[2])}/${Number(m[3])}`;
  }

  function getWeekdayNumFromIso(iso: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return 99;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const js = dt.getDay(); // Sun=0
    return js === 0 ? 7 : js; // Mon=1..Sun=7
  }

  const sortedLocalRows = useMemo(() => {
    const copied = [...localRows];
    if (!sortConfig) return copied;

    const { key, direction } = sortConfig;
    const multiplier = direction === "asc" ? 1 : -1;

    copied.sort((a, b) => {
      let result = 0;
      switch (key) {
        case "dateIso":
          result = a.dateIso.localeCompare(b.dateIso);
          break;
        case "weekday":
          result = getWeekdayNumFromIso(a.dateIso) - getWeekdayNumFromIso(b.dateIso);
          break;
        case "sortTime":
          result = a.sortTime.localeCompare(b.sortTime, "en", { numeric: true });
          break;
        case "room":
          result = a.room.localeCompare(b.room, "zh-Hant");
          break;
        case "tutor":
          result = a.tutor.localeCompare(b.tutor, "zh-Hant");
          break;
        case "note":
          result = a.note.localeCompare(b.note, "zh-Hant");
          break;
        case "school":
          result = a.school.localeCompare(b.school, "zh-Hant");
          break;
        case "examDate": {
          const ea = examDatesByStudentId[a.studentId] ?? "";
          const eb = examDatesByStudentId[b.studentId] ?? "";
          result = ea.localeCompare(eb);
          break;
        }
        case "lessonType":
          result = a.lessonType.localeCompare(b.lessonType, "zh-Hant");
          break;
        default:
          result = 0;
      }
      return result * multiplier;
    });

    return copied;
  }, [localRows, sortConfig, examDatesByStudentId]);

  useEffect(() => {
    setLocalRows(rows);
    for (const t of lessonSummarySaveTimersRef.current.values()) window.clearTimeout(t);
    lessonSummarySaveTimersRef.current.clear();
    lessonSummaryPendingRef.current.clear();
    initialNoteByRowKey.current = new Map(rows.map((r) => [r.rowKey, r.note]));
    latestNoteByRowKeyRef.current = new Map(rows.map((r) => [r.rowKey, r.note]));
  }, [rows]);

  useEffect(() => {
    if (!rows.length) return;

    let mounted = true;
    void (async () => {
      const studentIds = Array.from(new Set(rows.map((r) => r.studentId)));
      const nextMap: Record<string, string> = {};
      const missing: string[] = [];

      for (const id of studentIds) {
        const cached = examDateCache.current.get(id);
        if (cached !== undefined) nextMap[id] = cached;
        else missing.push(id);
      }

      // 先用 cache 補齊，讓 UI 不會閃爍
      if (mounted) setExamDatesByStudentId((prev) => ({ ...prev, ...nextMap }));

      if (missing.length === 0) return;

      const batch = await loadExamDatesBatch(missing);
      if (!mounted) return;
      for (const id of missing) {
        const v = batch[id] ?? "";
        examDateCache.current.set(id, v);
      }
      setExamDatesByStudentId((prev) => ({ ...prev, ...batch }));
    })();

    return () => {
      mounted = false;
    };
  }, [rows]);

  useEffect(() => {
    if (!rows.length) return;
    let mounted = true;
    void (async () => {
      const studentIds = Array.from(new Set(rows.map((r) => r.studentId)));
      const missing = studentIds.filter((id) => !stateCache.current.has(id));
      if (missing.length === 0) return;
      const batch = await loadLessonYearStatesBatch(missing, year);
      if (!mounted) return;
      for (const id of missing) {
        const st = batch[id];
        if (st) stateCache.current.set(id, st);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [rows, year]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const v = await loadTutorVisibility();
      if (!mounted) return;
      setTeacherOptions(v.activeSelectNames);
      setInactiveTutorNames(v.inactiveNames);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function getStudentState(studentId: string) {
    const cached = stateCache.current.get(studentId);
    if (cached) return cached;
    const loaded = await loadLessonYearState(studentId, year);
    stateCache.current.set(studentId, loaded);
    return loaded;
  }

  async function onToggle(row: RoomScheduleRow, checked: boolean) {
    setSaveError("");
    setSavingRowKey(row.rowKey);
    setLocalRows((prev) => prev.map((r) => (r.rowKey === row.rowKey ? { ...r, attended: checked } : r)));

    try {
      const current = await getStudentState(row.studentId);
      const nextState: StudentLesson2026State = {
        ...current,
        attendance: {
          ...current.attendance,
          [row.attendanceKey]: checked,
        },
      };
      await saveLessonYearState(row.studentId, year, nextState);
      stateCache.current.set(row.studentId, nextState);
    } catch (error) {
      setLocalRows((prev) => prev.map((r) => (r.rowKey === row.rowKey ? { ...r, attended: row.attended } : r)));
      setSaveError(error instanceof Error ? error.message : "儲存出席失敗");
    } finally {
      setSavingRowKey(null);
    }
  }

  async function onChangeTutor(row: RoomScheduleRow, displayTutor: string) {
    setSaveError("");
    setSavingRowKey(row.rowKey);
    const nextTutor = displayTutor.trim() || "待定";
    setLocalRows((prev) => prev.map((r) => (r.rowKey === row.rowKey ? { ...r, tutor: nextTutor } : r)));

    try {
      const current = await getStudentState(row.studentId);
      const overrides =
        current.overrides && typeof current.overrides === "object"
          ? (current.overrides as Record<string, unknown>)
          : {};
      const existing = overrides[row.dateIso];
      const existingEntry =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};

      const nextState: StudentLesson2026State = {
        ...current,
        overrides: {
          ...overrides,
          [row.dateIso]: {
            ...existingEntry,
            tutor: nextTutor === "待定" ? "" : nextTutor,
          },
        },
      };
      await saveLessonYearState(row.studentId, year, nextState);
      stateCache.current.set(row.studentId, nextState);
    } catch (error) {
      setLocalRows((prev) => prev.map((r) => (r.rowKey === row.rowKey ? { ...r, tutor: row.tutor } : r)));
      setSaveError(error instanceof Error ? error.message : "儲存導師失敗");
    } finally {
      setSavingRowKey(null);
    }
  }

  async function onChangeLessonSummary(row: RoomScheduleRow, nextNoteRaw: string) {
    const nextNote = nextNoteRaw.trim();

    setSaveError("");
    setSavingLessonSummaryRowKey(row.rowKey);
    try {
      const current = await getStudentState(row.studentId);
      const overrides =
        current.overrides && typeof current.overrides === "object"
          ? (current.overrides as Record<string, unknown>)
          : {};

      const existing = overrides[row.dateIso];
      const existingEntry =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};

      const nextState: StudentLesson2026State = {
        ...current,
        overrides: {
          ...overrides,
          [row.dateIso]: {
            ...existingEntry,
            lessonSummary: nextNote,
          },
        },
      };

      await saveLessonYearState(row.studentId, year, nextState);
      stateCache.current.set(row.studentId, nextState);
      initialNoteByRowKey.current.set(row.rowKey, nextNote);
    } catch (error) {
      // 失敗就回復先前 note
      const original = initialNoteByRowKey.current.get(row.rowKey) ?? row.note;
      // 若使用者在送出期間又繼續輸入，避免用失敗回復覆蓋更新
      const latest = latestNoteByRowKeyRef.current.get(row.rowKey) ?? "";
      if (latest.trim() === nextNote.trim()) {
        setLocalRows((prev) =>
          prev.map((r) => (r.rowKey === row.rowKey ? { ...r, note: original } : r)),
        );
      }
      setSaveError(error instanceof Error ? error.message : "儲存課堂摘要失敗");
    } finally {
      setSavingLessonSummaryRowKey(null);
    }
  }

  function persistLessonSummaryQueued(row: RoomScheduleRow, nextNote: string) {
    const rowKey = row.rowKey;
    if (lessonSummaryInFlightRef.current.has(rowKey)) {
      lessonSummaryPendingRef.current.set(rowKey, nextNote);
      return;
    }

    lessonSummaryInFlightRef.current.add(rowKey);
    void (async () => {
      try {
        await onChangeLessonSummary(row, nextNote);
      } finally {
        lessonSummaryInFlightRef.current.delete(rowKey);
        const pending = lessonSummaryPendingRef.current.get(rowKey);
        lessonSummaryPendingRef.current.delete(rowKey);
        if (pending !== undefined) {
          persistLessonSummaryQueued(row, pending);
        }
      }
    })();
  }

  function scheduleLessonSummarySave(row: RoomScheduleRow, nextValueRaw: string) {
    const rowKey = row.rowKey;
    const nextNote = nextValueRaw.trim();
    const original = initialNoteByRowKey.current.get(rowKey) ?? "";

    // 更新最新輸入（用於失敗回復避免覆蓋更新）
    latestNoteByRowKeyRef.current.set(rowKey, nextValueRaw);

    if (nextNote.trim() === original.trim()) {
      const timer = lessonSummarySaveTimersRef.current.get(rowKey);
      if (timer) window.clearTimeout(timer);
      lessonSummarySaveTimersRef.current.delete(rowKey);
      return;
    }

    const oldTimer = lessonSummarySaveTimersRef.current.get(rowKey);
    if (oldTimer) window.clearTimeout(oldTimer);

    const handle = window.setTimeout(() => {
      lessonSummarySaveTimersRef.current.delete(rowKey);
      persistLessonSummaryQueued(row, nextNote);
    }, 600);

    lessonSummarySaveTimersRef.current.set(rowKey, handle);
  }

  if (localRows.length === 0) return null;

  return (
    <div>
      {saveError ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          儲存失敗：{saveError}
        </p>
      ) : null}
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-[960px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-600">
              <th className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-3 py-2">學號</th>
              <th className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-3 py-2">姓名</th>
              <th className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-3 py-2">年級</th>
              <th className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-3 py-2">出席</th>
              <RoomSortableHeader label="日期" columnKey="dateIso" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="星期" columnKey="weekday" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="時間" columnKey="sortTime" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="房" columnKey="room" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="導師" columnKey="tutor" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="課堂摘要" columnKey="note" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="學校" columnKey="school" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="考試日期" columnKey="examDate" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="類型" columnKey="lessonType" sortConfig={sortConfig} setSortConfig={setSortConfig} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedLocalRows.map((r) => (
              <tr key={r.rowKey}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-800">
                  {(() => {
                    const studentIdDisplay = normalizeStudentId(r.studentId);
                    return canOpenStudentLink ? (
                      <Link
                        href={`/students/${encodeURIComponent(studentIdDisplay)}/lessons/${year}`}
                        className="text-[#1d76c2] hover:underline"
                      >
                        {studentIdDisplay}
                      </Link>
                    ) : (
                      studentIdDisplay
                    );
                  })()}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-800">{r.studentName}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{formatGradeDisplay(r.grade) || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-center text-slate-800">
                  <input
                    type="checkbox"
                    checked={r.attended}
                    disabled={readOnly || savingRowKey === r.rowKey}
                    onChange={(event) => void onToggle(r, event.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-[#1d76c2]"
                    aria-label={`切換 ${normalizeStudentId(r.studentId)} ${r.dateDisplay} ${r.time} 出席`}
                    suppressHydrationWarning
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-800">{r.dateDisplay}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.weekdayDisplay}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-800">{r.time}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.room}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                  <select
                    value={
                      r.tutor &&
                      r.tutor !== "—" &&
                      !inactiveTutorNames.has(r.tutor.trim())
                        ? r.tutor
                        : "待定"
                    }
                    disabled={readOnly || savingRowKey === r.rowKey}
                    onChange={(event) => void onChangeTutor(r, event.target.value)}
                    className="min-w-[120px] rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    aria-label={`${normalizeStudentId(r.studentId)} 導師`}
                    suppressHydrationWarning
                  >
                    <option value="待定">待定</option>
                    {teacherOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <textarea
                    value={r.note || ""}
                    disabled={readOnly || r.lessonType === "補堂"}
                    aria-busy={savingLessonSummaryRowKey === r.rowKey}
                    placeholder="輸入課堂摘要"
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setLocalRows((prev) =>
                        prev.map((row) => (row.rowKey === r.rowKey ? { ...row, note: nextValue } : row)),
                      );
                      scheduleLessonSummarySave(r, nextValue);
                    }}
                    className={[
                      "w-full max-w-[200px] resize-none rounded border px-2 py-1 text-xs outline-none transition",
                      r.lessonType === "補堂"
                        ? "border-slate-200 bg-slate-50 text-slate-500"
                        : "border-slate-300 bg-white text-slate-700 focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]",
                      savingLessonSummaryRowKey === r.rowKey ? "opacity-90" : "",
                    ].join(" ")}
                    aria-label={`${normalizeStudentId(r.studentId)} ${r.dateDisplay} 課堂摘要`}
                    suppressHydrationWarning
                    rows={3}
                  />
                </td>
                <td
                  className="max-w-[220px] whitespace-normal break-words px-3 py-2 text-xs text-slate-600 overflow-hidden [display:-webkit-box] [WebkitBoxOrient:vertical] [WebkitLineClamp:2]"
                  title={r.school || ""}
                >
                  {r.school || "—"}
                </td>
                <td
                  className="max-w-[100px] truncate px-3 py-2 text-slate-500"
                  title={examDatesByStudentId[r.studentId] ? formatExamDateDisplay(examDatesByStudentId[r.studentId]) : "—"}
                >
                  {examDatesByStudentId[r.studentId]
                    ? formatExamDateDisplay(examDatesByStudentId[r.studentId])
                    : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.lessonType === "恆常"
                        ? "bg-emerald-50 text-emerald-800"
                        : r.lessonType === "補堂"
                          ? "bg-amber-50 text-amber-900"
                          : "bg-violet-50 text-violet-800"
                    }`}
                  >
                    {r.lessonType}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type RoomSortableHeaderProps = {
  label: string;
  columnKey: RoomScheduleSortKey;
  sortConfig: RoomScheduleSortConfig;
  setSortConfig: (config: RoomScheduleSortConfig) => void;
};

function RoomSortableHeader({ label, columnKey, sortConfig, setSortConfig }: RoomSortableHeaderProps) {
  const selectedDirection = sortConfig?.key === columnKey ? sortConfig.direction : "";
  return (
    <th className="sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 text-left text-xs font-bold tracking-wider text-slate-600">
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="whitespace-nowrap">{label}</span>
        <select
          aria-label={`${label} 排序`}
          value={selectedDirection}
          onChange={(event) => {
            const direction = event.target.value as SortDirection | "";
            if (!direction) {
              setSortConfig(null);
              return;
            }
            setSortConfig({ key: columnKey, direction });
          }}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-700"
        >
          <option value="">▽</option>
          <option value="asc">↑</option>
          <option value="desc">↓</option>
        </select>
      </div>
    </th>
  );
}
