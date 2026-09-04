"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { RoomScheduleRow } from "@/lib/roomScheduleAggregate";
import type { YearLessonState } from "@/lib/yearScheduleCore";
import { normalizeStudentId } from "@/lib/studentId";
import {
  formatVisibleExamDateSlashed,
  visibleExamContent,
  visibleExamDateIso,
} from "@/lib/examDateVisibility";
import {
  loadExamInfoBatch,
  type StudentLesson2026State,
} from "@/lib/studentLessonStorage";
import { DEFAULT_LESSON_YEAR_STATE } from "@/lib/lessonYearStateShared";
import {
  flushSaveLessonYearStateQueue,
  queueSaveLessonYearState,
  retrySaveLessonYearState,
} from "@/lib/queueSaveLessonYearState";
import { revalidateScheduleCachesNow } from "@/lib/scheduleCacheClient";
import { subscribeLessonSaveStatus } from "@/lib/lessonSaveStatus";
import { loadTutorVisibility } from "@/lib/tutorVisibility";
import { isSharedIpadTutorDisplayName } from "@/lib/tutorConstants";
import { attendanceAfterRegularToggle } from "@/lib/lessonScheduleVersions";
import { formatGradeDisplay } from "@/lib/grade";
import { hkTodayIso } from "@/lib/examDateVisibility";
import { useRoomLessonStateRealtime } from "@/lib/useRoomLessonStateRealtime";
import { useCustomScrollbars } from "@/lib/useCustomScrollbars";
import ClientOnlyAfterMount from "@/components/ClientOnlyAfterMount";

function RoomScheduleTableSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="mb-3 flex gap-2">
        <div className="h-8 w-40 rounded-md bg-slate-200" />
        <div className="h-8 w-28 rounded-md bg-slate-200" />
        <div className="h-8 w-32 rounded-md bg-slate-200" />
        <div className="h-8 w-32 rounded-md bg-slate-200" />
      </div>
      <div className="h-[min(70vh,640px)] rounded-lg border border-slate-200 bg-slate-50" />
    </div>
  );
}

type Props = {
  rows: RoomScheduleRow[];
  year: number;
  /** Server-loaded year state for students on this page (avoids duplicate client fetch). */
  initialYearStatesByStudentId?: Record<string, YearLessonState>;
  canOpenStudentLink?: boolean;
  /** 鎖定出席 checkbox */
  attendanceLocked?: boolean;
  /** 鎖定導師下拉 */
  tutorFieldLocked?: boolean;
  /** 導師帳：仍可改 Lesson summary（當 tutorFieldLocked 為 true 時） */
  allowSummaryEdit?: boolean;
  /** 共用 iPad 帳：出席／summary 僅可改香港今日堂 */
  restrictAttendanceAndSummaryToToday?: boolean;
  /** 共用 iPad 帳：不顯示學號欄 */
  hideStudentId?: boolean;
  /** admin：/students/{id}/lessons；共用 iPad：/lessons/{year}?next=房間 */
  studentLessonsHrefMode?: "hub" | "yearFromRoom";
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
  initialYearStatesByStudentId = {},
  canOpenStudentLink = true,
  attendanceLocked = false,
  tutorFieldLocked = false,
  allowSummaryEdit = false,
  restrictAttendanceAndSummaryToToday = false,
  hideStudentId = false,
  studentLessonsHrefMode = "yearFromRoom",
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const summaryLocked = tutorFieldLocked && !allowSummaryEdit;
  const todayIso = hkTodayIso();
  const isAttendanceOrSummaryEditableForDate = useCallback(
    (dateIso: string) => {
      if (!restrictAttendanceAndSummaryToToday) return true;
      return dateIso.trim() === todayIso;
    },
    [restrictAttendanceAndSummaryToToday, todayIso],
  );
  const returnTo = useMemo(() => {
    const q = searchParams?.toString() ?? "";
    return q ? `${pathname}?${q}` : pathname;
  }, [pathname, searchParams]);

  const studentLessonsHref = useCallback(
    (studentId: string) => {
      const id = encodeURIComponent(normalizeStudentId(studentId));
      if (studentLessonsHrefMode === "hub") {
        return `/students/${id}/lessons`;
      }
      return `/students/${id}/lessons/${year}?next=${encodeURIComponent(returnTo)}`;
    },
    [studentLessonsHrefMode, year, returnTo],
  );

  const STICKY_ID_WIDTH = 92;
  const STICKY_NAME_WIDTH = 190;
  const STICKY_GRADE_WIDTH = 90;
  const STICKY_ATTENDANCE_WIDTH = 110;
  const stickyNameLeft = hideStudentId ? 0 : STICKY_ID_WIDTH;
  const stickyGradeLeft = stickyNameLeft + STICKY_NAME_WIDTH;
  const stickyAttendanceLeft = stickyGradeLeft + STICKY_GRADE_WIDTH;

  function rowAriaStudentLabel(r: Pick<RoomScheduleRow, "studentId" | "studentName">) {
    return hideStudentId ? r.studentName : normalizeStudentId(r.studentId);
  }

  const [localRows, setLocalRows] = useState(rows);
  const [sortConfig, setSortConfig] = useState<RoomScheduleSortConfig>(null);
  const [savingStudentIds, setSavingStudentIds] = useState<Set<string>>(() => new Set());
  const [savedFlashStudentIds, setSavedFlashStudentIds] = useState<Set<string>>(() => new Set());
  const [savingLessonSummaryRowKey, setSavingLessonSummaryRowKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saveErrorStudentId, setSaveErrorStudentId] = useState("");
  const saveErrorStudentIdRef = useRef("");
  const [teacherOptions, setTeacherOptions] = useState<string[]>([]);
  const [inactiveTutorNames, setInactiveTutorNames] = useState<Set<string>>(new Set());
  const [activeTutorAliasToNickname, setActiveTutorAliasToNickname] = useState<Map<string, string>>(
    new Map(),
  );
  const [examDatesByStudentId, setExamDatesByStudentId] = useState<Record<string, string>>({});
  const [examContentsByStudentId, setExamContentsByStudentId] = useState<Record<string, string>>({});
  const [tutorFilter, setTutorFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [lessonTypeFilter, setLessonTypeFilter] = useState("all");
  const [attendanceFilter, setAttendanceFilter] = useState<"all" | "attended" | "not_attended">("all");
  const stateCache = useRef(new Map<string, StudentLesson2026State>());
  /** Students whose full year state has been loaded from Supabase (not just attendance from rows). */
  const cloudStateLoadedRef = useRef(new Set<string>());
  const initialNoteByRowKey = useRef(new Map<string, string>());
  const latestNoteByRowKeyRef = useRef(new Map<string, string>());
  const lessonSummarySaveTimersRef = useRef(new Map<string, number>());
  const lessonSummaryPendingRef = useRef(new Map<string, string>());
  const lessonSummaryInFlightRef = useRef(new Set<string>());
  const savedFlashTimersRef = useRef(new Map<string, number>());
  const savingRowKeyRef = useRef<string | null>(null);
  const savingLessonSummaryRowKeyRef = useRef<string | null>(null);
  const examDateCache = useRef(new Map<string, string>());

  savingLessonSummaryRowKeyRef.current = savingLessonSummaryRowKey;

  function markStudentSaving(studentId: string) {
    setSavingStudentIds((prev) => {
      if (prev.has(studentId)) return prev;
      const next = new Set(prev);
      next.add(studentId);
      return next;
    });
    setSavedFlashStudentIds((prev) => {
      if (!prev.has(studentId)) return prev;
      const next = new Set(prev);
      next.delete(studentId);
      return next;
    });
    const existingTimer = savedFlashTimersRef.current.get(studentId);
    if (existingTimer != null) window.clearTimeout(existingTimer);
    savedFlashTimersRef.current.delete(studentId);
  }

  function markStudentSaved(studentId: string) {
    setSavingStudentIds((prev) => {
      if (!prev.has(studentId)) return prev;
      const next = new Set(prev);
      next.delete(studentId);
      return next;
    });
    if (saveErrorStudentIdRef.current === studentId) {
      saveErrorStudentIdRef.current = "";
      setSaveErrorStudentId("");
      setSaveError("");
    }
    savingRowKeyRef.current = null;
    setSavedFlashStudentIds((prev) => new Set(prev).add(studentId));
    const existingTimer = savedFlashTimersRef.current.get(studentId);
    if (existingTimer != null) window.clearTimeout(existingTimer);
    savedFlashTimersRef.current.set(
      studentId,
      window.setTimeout(() => {
        savedFlashTimersRef.current.delete(studentId);
        setSavedFlashStudentIds((prev) => {
          if (!prev.has(studentId)) return prev;
          const next = new Set(prev);
          next.delete(studentId);
          return next;
        });
      }, 2000),
    );
  }

  function isStudentSaving(studentId: string, row: RoomScheduleRow) {
    return savingStudentIds.has(studentId) || savingLessonSummaryRowKey === row.rowKey;
  }

  const studentIdsOnPage = useMemo(
    () => new Set(localRows.map((r) => r.studentId).filter(Boolean)),
    [localRows],
  );

  useEffect(() => {
    return subscribeLessonSaveStatus((evt) => {
      if (evt.kind !== "year" || evt.year !== year) return;
      if (!studentIdsOnPage.has(evt.studentId)) return;
      if (evt.status === "saving") {
        markStudentSaving(evt.studentId);
      } else if (evt.status === "saved") {
        markStudentSaved(evt.studentId);
      } else if (evt.status === "failed") {
        setSavingStudentIds((prev) => {
          if (!prev.has(evt.studentId)) return prev;
          const next = new Set(prev);
          next.delete(evt.studentId);
          return next;
        });
        saveErrorStudentIdRef.current = evt.studentId;
        setSaveErrorStudentId(evt.studentId);
        setSaveError(evt.message ?? "Cloud save failed. Please retry.");
      }
    });
  }, [year, studentIdsOnPage]);

  useEffect(() => {
    const timersRef = savedFlashTimersRef;
    return () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  useRoomLessonStateRealtime({
    year,
    rows,
    stateCache,
    initialNoteByRowKey,
    latestNoteByRowKeyRef,
    setLocalRows,
    savingRowKeyRef,
    savingLessonSummaryRowKeyRef,
    lessonSummaryPendingRef,
  });

  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  function slotKey(r: Pick<RoomScheduleRow, "dateIso" | "time" | "room">) {
    return `${r.dateIso}__${r.time}__${r.room}`.toLowerCase();
  }

  function lessonSlotKey(r: Pick<RoomScheduleRow, "dateIso" | "sortTime">) {
    return `${r.dateIso}__${r.sortTime}`;
  }

  const tableColumnCount = hideStudentId ? 14 : 15;
  const showLessonSlotDividers = !sortConfig;

  function normalizeTutorLabel(raw: string) {
    const v = String(raw ?? "").trim();
    if (!v || v === "—" || v.toLowerCase() === "tbd" || v === "待定") return "TBD";
    return v;
  }

  function lessonTypeLabel(type: string) {
    if (type === "恆常") return "Regular";
    if (type === "補堂") return "Reschedule";
    if (type === "加堂") return "Extra";
    if (type === "取消") return "Cancelled";
    return type || "—";
  }

  function lessonTypeKey(type: string) {
    if (type === "恆常") return "regular";
    if (type === "補堂") return "makeup";
    if (type === "加堂") return "extra";
    if (type === "取消") return "cancelled";
    return type ? `other:${type}` : "unknown";
  }

  function weekdayLabelFromIso(iso: string) {
    const weekday = getWeekdayNumFromIso(iso);
    if (weekday === 1) return "Mon";
    if (weekday === 2) return "Tue";
    if (weekday === 3) return "Wed";
    if (weekday === 4) return "Thu";
    if (weekday === 5) return "Fri";
    if (weekday === 6) return "Sat";
    if (weekday === 7) return "Sun";
    return "—";
  }

  function formatExamDateDisplay(iso: string) {
    return formatVisibleExamDateSlashed(iso);
  }

  function getWeekdayNumFromIso(iso: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return 99;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const js = dt.getDay(); // Sun=0
    return js === 0 ? 7 : js; // Mon=1..Sun=7
  }

  const filteredRows = useMemo(() => {
    return localRows.filter((r) => {
      const matchesTutor = tutorFilter === "all" || normalizeTutorLabel(r.tutor) === tutorFilter;
      const matchesGrade =
        gradeFilter === "all" || (formatGradeDisplay(r.grade) || "—") === gradeFilter;
      const matchesType = lessonTypeFilter === "all" || lessonTypeKey(r.lessonType) === lessonTypeFilter;
      const matchesAttendance =
        attendanceFilter === "all" ||
        (attendanceFilter === "attended" ? r.attended === true : r.attended === false);
      return matchesTutor && matchesGrade && matchesType && matchesAttendance;
    });
  }, [attendanceFilter, gradeFilter, lessonTypeFilter, localRows, tutorFilter]);

  const sortedLocalRows = useMemo(() => {
    const copied = [...filteredRows];
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
  }, [filteredRows, sortConfig, examDatesByStudentId]);

  const {
    tableScrollId,
    bottomTrackRef,
    sideTrackRef,
    bottomThumb,
    sideThumb,
    bottomScrollWidth,
    bottomScrollClientWidth,
    sideScrollHeight,
    sideScrollClientHeight,
    bottomTrackA11yProps,
    sideTrackA11yProps,
    onBottomTrackMouseDown,
    onSideTrackMouseDown,
    startDragBottomThumb,
    startDragSideThumb,
  } = useCustomScrollbars({
    tableScrollRef,
    contentKey: sortedLocalRows.length,
  });

  function seedAttendanceFromRows(nextRows: RoomScheduleRow[]) {
    const attendanceByStudent = new Map<string, Record<string, boolean>>();
    for (const r of nextRows) {
      const prev = attendanceByStudent.get(r.studentId) ?? {};
      prev[r.attendanceKey] = r.attended;
      attendanceByStudent.set(r.studentId, prev);
    }
    for (const [studentId, attendance] of attendanceByStudent) {
      const existing = stateCache.current.get(studentId);
      if (!existing) continue;
      stateCache.current.set(studentId, {
        ...existing,
        attendance: { ...existing.attendance, ...attendance },
      });
    }
  }

  useEffect(() => {
    setLocalRows(rows);
    stateCache.current.clear();
    cloudStateLoadedRef.current.clear();
    for (const [studentId, state] of Object.entries(initialYearStatesByStudentId)) {
      stateCache.current.set(studentId, state as StudentLesson2026State);
      cloudStateLoadedRef.current.add(studentId);
    }
    seedAttendanceFromRows(rows);
    for (const t of lessonSummarySaveTimersRef.current.values()) window.clearTimeout(t);
    lessonSummarySaveTimersRef.current.clear();
    lessonSummaryPendingRef.current.clear();
    initialNoteByRowKey.current = new Map(rows.map((r) => [r.rowKey, r.note]));
    latestNoteByRowKeyRef.current = new Map(rows.map((r) => [r.rowKey, r.note]));
  }, [rows, initialYearStatesByStudentId]);

  const gradeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of localRows) {
      const g = formatGradeDisplay(r.grade);
      if (g) set.add(g);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "en"));
  }, [localRows]);

  const tutorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of localRows) {
      set.add(normalizeTutorLabel(r.tutor));
    }
    for (const t of teacherOptions) set.add(t);
    return Array.from(set)
      .map((s) => s.trim())
      .filter((s) => Boolean(s) && !isSharedIpadTutorDisplayName(s))
      .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [localRows, teacherOptions]);

  const lessonTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of localRows) set.add(lessonTypeKey(r.lessonType));
    const preferred = ["regular", "makeup", "extra"];
    const rest = Array.from(set).filter((k) => !preferred.includes(k) && k !== "cancelled");
    return [...preferred.filter((k) => set.has(k)), ...rest.sort((a, b) => a.localeCompare(b, "en"))];
  }, [localRows]);

  function resetFilters() {
    setTutorFilter("all");
    setGradeFilter("all");
    setLessonTypeFilter("all");
    setAttendanceFilter("all");
  }

  useEffect(() => {
    if (!rows.length) return;

    let mounted = true;
    void (async () => {
      const studentIds = Array.from(new Set(rows.map((r) => r.studentId)));
      const nextDateMap: Record<string, string> = {};
      const nextContentMap: Record<string, string> = {};
      const missing: string[] = [];

      for (const id of studentIds) {
        const cached = examDateCache.current.get(id);
        if (cached !== undefined) nextDateMap[id] = visibleExamDateIso(cached);
        else missing.push(id);
      }

      // 先用 cache 補齊，讓 UI 不會閃爍
      if (mounted) setExamDatesByStudentId((prev) => ({ ...prev, ...nextDateMap }));

      if (missing.length === 0) return;

      const batch = await loadExamInfoBatch(missing);
      if (!mounted) return;
      for (const id of missing) {
        const info = batch[id] ?? { examDate: "", examContent: "" };
        examDateCache.current.set(id, info.examDate);
        const visibleDate = visibleExamDateIso(info.examDate);
        nextContentMap[id] = visibleDate ? visibleExamContent(info.examDate, info.examContent) : "";
      }
      const dateBatch: Record<string, string> = {};
      for (const [id, info] of Object.entries(batch)) {
        dateBatch[id] = visibleExamDateIso(info.examDate ?? "");
      }
      setExamDatesByStudentId((prev) => ({ ...prev, ...dateBatch }));
      setExamContentsByStudentId((prev) => ({ ...prev, ...nextContentMap }));
    })();

    return () => {
      mounted = false;
    };
  }, [rows]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const v = await loadTutorVisibility();
      if (!mounted) return;
      setTeacherOptions(v.activeSelectNames);
      setInactiveTutorNames(v.inactiveNames);
      setActiveTutorAliasToNickname(v.activeAliasToNickname);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function onToggle(row: RoomScheduleRow, checked: boolean) {
    if (attendanceLocked || !isAttendanceOrSummaryEditableForDate(row.dateIso)) return;
    setSaveError("");
    savingRowKeyRef.current = row.rowKey;
    markStudentSaving(row.studentId);
    setLocalRows((prev) => prev.map((r) => (r.rowKey === row.rowKey ? { ...r, attended: checked } : r)));

    const current = stateCache.current.get(row.studentId) ?? { ...DEFAULT_LESSON_YEAR_STATE };
    const nextState: StudentLesson2026State = {
      ...current,
      attendance: attendanceAfterRegularToggle(current.attendance, row.attendanceKey, checked),
    };
    stateCache.current.set(row.studentId, nextState);
    queueSaveLessonYearState(row.studentId, year, nextState, ["attendance"], [row.attendanceKey]);
  }

  /** Clear attendance for all currently filtered, editable, attended rows (same room page). */
  function onMarkFilteredAbsent() {
    if (attendanceLocked) return;
    const targets = filteredRows.filter(
      (r) =>
        r.attended &&
        isAttendanceOrSummaryEditableForDate(r.dateIso) &&
        !isStudentSaving(r.studentId, r),
    );
    if (targets.length === 0) {
      window.alert("No attended rows in the current filter can be cleared.");
      return;
    }
    const slotHint =
      targets.length <= 3
        ? targets.map((r) => `${r.dateDisplay} ${r.time}`).join(", ")
        : `${targets[0]?.dateDisplay} ${targets[0]?.time} … (+${targets.length - 1} more)`;
    if (
      !window.confirm(
        `Mark ${targets.length} student row(s) as not attended?\n${slotHint}\n\nIf this tutor’s slot ends with 0 ticks (past/today), Tutor Monthly will still pay 1× Single Student Rate.`,
      )
    ) {
      return;
    }
    setSaveError("");
    // Group by student so one save merges all their attendance keys.
    const byStudent = new Map<string, RoomScheduleRow[]>();
    for (const r of targets) {
      const list = byStudent.get(r.studentId) ?? [];
      list.push(r);
      byStudent.set(r.studentId, list);
    }
    const clearKeys = new Set(targets.map((t) => t.rowKey));
    setLocalRows((prev) =>
      prev.map((r) => (clearKeys.has(r.rowKey) ? { ...r, attended: false } : r)),
    );
    for (const [studentId, rowsForStudent] of byStudent) {
      markStudentSaving(studentId);
      savingRowKeyRef.current = rowsForStudent[0]?.rowKey ?? null;
      let current = stateCache.current.get(studentId) ?? { ...DEFAULT_LESSON_YEAR_STATE };
      let attendance = { ...current.attendance };
      const touchedKeys: string[] = [];
      for (const r of rowsForStudent) {
        attendance = attendanceAfterRegularToggle(attendance, r.attendanceKey, false);
        touchedKeys.push(r.attendanceKey);
      }
      const nextState: StudentLesson2026State = { ...current, attendance };
      stateCache.current.set(studentId, nextState);
      queueSaveLessonYearState(studentId, year, nextState, ["attendance"], touchedKeys);
    }
  }

  async function onChangeTutor(row: RoomScheduleRow, displayTutor: string) {
    setSaveError("");
    const slot = slotKey(row);
    const nextTutor = displayTutor.trim() || "TBD";
    const affected = localRows.filter((r) => slotKey(r) === slot);

    setLocalRows((prev) => prev.map((r) => (slotKey(r) === slot ? { ...r, tutor: nextTutor } : r)));

    for (const r of affected) {
      markStudentSaving(r.studentId);
      savingRowKeyRef.current = r.rowKey;
      const current = stateCache.current.get(r.studentId) ?? { ...DEFAULT_LESSON_YEAR_STATE };
      const overrides =
        current.overrides && typeof current.overrides === "object"
          ? (current.overrides as Record<string, unknown>)
          : {};
      const existing = overrides[r.dateIso];
      const existingEntry =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};

      const nextState: StudentLesson2026State = {
        ...current,
        overrides: {
          ...overrides,
          [r.dateIso]: {
            ...existingEntry,
            tutor: nextTutor === "TBD" ? "" : nextTutor,
          },
        },
      };
      stateCache.current.set(r.studentId, nextState);
      queueSaveLessonYearState(r.studentId, year, nextState, ["overrides"], undefined, [r.dateIso]);
    }

    try {
      await flushSaveLessonYearStateQueue();
      await revalidateScheduleCachesNow();
      router.refresh();
    } catch {
      // saveError is set via subscribeLessonSaveStatus
    }
  }

  function onChangeLessonSummary(row: RoomScheduleRow, nextNoteRaw: string) {
    if (summaryLocked || !isAttendanceOrSummaryEditableForDate(row.dateIso)) return;
    const nextNote = nextNoteRaw.trim();

    setSaveError("");
    const current = stateCache.current.get(row.studentId) ?? { ...DEFAULT_LESSON_YEAR_STATE };
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

    stateCache.current.set(row.studentId, nextState);
    initialNoteByRowKey.current.set(row.rowKey, nextNote);
    queueSaveLessonYearState(row.studentId, year, nextState, ["overrides"]);
  }

  function persistLessonSummaryQueued(row: RoomScheduleRow, nextNote: string) {
    const rowKey = row.rowKey;
    if (lessonSummaryInFlightRef.current.has(rowKey)) {
      lessonSummaryPendingRef.current.set(rowKey, nextNote);
      return;
    }

    lessonSummaryInFlightRef.current.add(rowKey);
    setSavingLessonSummaryRowKey(rowKey);
    savingLessonSummaryRowKeyRef.current = rowKey;
    markStudentSaving(row.studentId);
    void (async () => {
      try {
        await onChangeLessonSummary(row, nextNote);
      } finally {
        lessonSummaryInFlightRef.current.delete(rowKey);
        setSavingLessonSummaryRowKey((current) => (current === rowKey ? null : current));
        savingLessonSummaryRowKeyRef.current =
          savingLessonSummaryRowKeyRef.current === rowKey ? null : savingLessonSummaryRowKeyRef.current;
        const pending = lessonSummaryPendingRef.current.get(rowKey);
        lessonSummaryPendingRef.current.delete(rowKey);
        if (pending !== undefined) {
          persistLessonSummaryQueued(row, pending);
        }
      }
    })();
  }

  function scheduleLessonSummarySave(row: RoomScheduleRow, nextValueRaw: string) {
    if (summaryLocked || !isAttendanceOrSummaryEditableForDate(row.dateIso)) return;
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
    <ClientOnlyAfterMount fallback={<RoomScheduleTableSkeleton />}>
    <div>
      {saveError ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              <span className="font-semibold">Cloud save failed:</span> {saveError}
            </p>
            {saveErrorStudentId ? (
              <button
                type="button"
                onClick={() => retrySaveLessonYearState(saveErrorStudentId, year)}
                className="shrink-0 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100"
              >
                Retry
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-red-700">
            Changes are shown on screen but may not be saved yet. Retry before leaving this page.
          </p>
        </div>
      ) : null}
      {savingStudentIds.size > 0 ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Saving {savingStudentIds.size} change{savingStudentIds.size === 1 ? "" : "s"}…
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wider text-slate-500">Tutor</span>
            <select
              value={tutorFilter}
              onChange={(e) => setTutorFilter(e.target.value)}
              className="h-8 min-w-[160px] rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            >
              <option value="all">All</option>
              {tutorOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wider text-slate-500">Grade</span>
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="h-8 min-w-[120px] rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            >
              <option value="all">All</option>
              {gradeOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wider text-slate-500">Lesson Type</span>
            <select
              value={lessonTypeFilter}
              onChange={(e) => setLessonTypeFilter(e.target.value)}
              className="h-8 min-w-[140px] rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            >
              <option value="all">All</option>
              {lessonTypeOptions.map((k) => (
                <option key={k} value={k}>
                  {k === "regular"
                    ? "Regular"
                    : k === "makeup"
                      ? "Reschedule"
                      : k === "extra"
                        ? "Extra"
                        : k.startsWith("other:")
                          ? k.slice("other:".length)
                          : k}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wider text-slate-500">Attendance</span>
            <select
              value={attendanceFilter}
              onChange={(e) =>
                setAttendanceFilter(e.target.value as "all" | "attended" | "not_attended")
              }
              className="h-8 min-w-[140px] rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            >
              <option value="all">All</option>
              <option value="attended">Attended</option>
              <option value="not_attended">Not attended</option>
            </select>
          </label>

          <button
            type="button"
            onClick={onMarkFilteredAbsent}
            disabled={attendanceLocked}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-950 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            title="Clear attendance for all attended rows in the current filter. Past/today slots with 0 ticks still pay Single on Tutor Monthly."
          >
            Mark filtered absent
          </button>

          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex h-8 items-center gap-1.5 rounded bg-[#1d76c2] px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1663a3]"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path
                transform="translate(0,-1.8)"
                d="M4.08 11.86a5.5 5.5 0 019.27-3.59l-.94.94a.75.75 0 001.06 1.06l2.5-2.5a.75.75 0 000-1.06l-2.5-2.5a.75.75 0 00-1.06 1.06l.99.99a7 7 0 00-11.3 5.59.75.75 0 001.5 0z"
              />
              <path
                transform="translate(0,1.8)"
                d="M15.92 8.14a.75.75 0 00-1.5 0 5.5 5.5 0 01-9.27 3.59l.94-.94a.75.75 0 10-1.06-1.06l-2.5 2.5a.75.75 0 000 1.06l2.5 2.5a.75.75 0 001.06-1.06l-.99-.99a7 7 0 0011.3-5.59z"
              />
            </svg>
            Reset Filters
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex">
          <div
            ref={tableScrollRef}
            id={tableScrollId}
            className="max-h-[70vh] flex-1 overflow-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <table className="min-w-[1200px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold tracking-wider text-slate-600">
              {hideStudentId ? null : (
                <th
                  className="sticky left-0 top-0 z-50 whitespace-nowrap bg-slate-50 px-3 py-2"
                  style={{ width: STICKY_ID_WIDTH, minWidth: STICKY_ID_WIDTH, maxWidth: STICKY_ID_WIDTH }}
                >
                  ID
                </th>
              )}
              <th
                className={[
                  "sticky top-0 z-50 whitespace-nowrap bg-slate-50 px-3 py-2",
                  hideStudentId ? "left-0" : "",
                ].join(" ")}
                style={{
                  left: stickyNameLeft,
                  width: STICKY_NAME_WIDTH,
                  minWidth: STICKY_NAME_WIDTH,
                  maxWidth: STICKY_NAME_WIDTH,
                }}
              >
                Name
              </th>
              <th
                className="sticky top-0 z-50 whitespace-nowrap bg-slate-50 px-3 py-2"
                style={{
                  left: stickyGradeLeft,
                  width: STICKY_GRADE_WIDTH,
                  minWidth: STICKY_GRADE_WIDTH,
                  maxWidth: STICKY_GRADE_WIDTH,
                }}
              >
                Grade
              </th>
              <th
                className="sticky top-0 z-50 whitespace-nowrap bg-slate-50 px-3 py-2 text-center"
                style={{
                  left: stickyAttendanceLeft,
                  width: STICKY_ATTENDANCE_WIDTH,
                  minWidth: STICKY_ATTENDANCE_WIDTH,
                  maxWidth: STICKY_ATTENDANCE_WIDTH,
                }}
              >
                Attendance
              </th>
              <RoomSortableHeader label="Date" columnKey="dateIso" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="Weekday" columnKey="weekday" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="Time" columnKey="sortTime" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="Room" columnKey="room" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="Tutor" columnKey="tutor" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="Lesson Summary" columnKey="note" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="School" columnKey="school" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <RoomSortableHeader label="Exam Date" columnKey="examDate" sortConfig={sortConfig} setSortConfig={setSortConfig} />
              <th className="sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 text-left text-xs font-bold tracking-wider text-slate-600">
                Exam Content
              </th>
              <th className="sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 text-left text-xs font-bold tracking-wider text-slate-600">
                Textbook publisher
              </th>
              <RoomSortableHeader label="Type" columnKey="lessonType" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedLocalRows.map((r, idx) => {
                  const prev = idx > 0 ? sortedLocalRows[idx - 1] : null;
                  const showSlotDivider =
                    showLessonSlotDividers &&
                    idx > 0 &&
                    lessonSlotKey(r) !== lessonSlotKey(prev!);
                  return (
                    <Fragment key={`${r.rowKey}:${idx}`}>
                      {showSlotDivider ? (
                        <tr aria-hidden>
                          <td colSpan={tableColumnCount} className="h-0 border-t-2 border-slate-400 p-0" />
                        </tr>
                      ) : null}
                      <tr className="group bg-white hover:bg-slate-50">
                {hideStudentId ? null : (
                  <td
                    className="sticky left-0 z-40 whitespace-nowrap bg-white px-3 py-2 font-mono text-xs text-slate-800 group-hover:bg-slate-50"
                    style={{ width: STICKY_ID_WIDTH, minWidth: STICKY_ID_WIDTH, maxWidth: STICKY_ID_WIDTH }}
                  >
                    {(() => {
                      const studentIdDisplay = normalizeStudentId(r.studentId);
                      return canOpenStudentLink ? (
                        <Link
                          href={studentLessonsHref(r.studentId)}
                          className="text-[#1d76c2] hover:underline"
                        >
                          {studentIdDisplay}
                        </Link>
                      ) : (
                        studentIdDisplay
                      );
                    })()}
                  </td>
                )}
                <td
                  className={[
                    "sticky z-40 whitespace-nowrap bg-white px-3 py-2 text-slate-800 group-hover:bg-slate-50",
                    hideStudentId ? "left-0" : "",
                  ].join(" ")}
                  style={{
                    left: stickyNameLeft,
                    width: STICKY_NAME_WIDTH,
                    minWidth: STICKY_NAME_WIDTH,
                    maxWidth: STICKY_NAME_WIDTH,
                  }}
                >
                  {(() => {
                    return canOpenStudentLink ? (
                      <Link
                        href={studentLessonsHref(r.studentId)}
                        className="block overflow-hidden text-ellipsis whitespace-nowrap text-[#1d76c2] hover:underline"
                      >
                        {r.studentName}
                      </Link>
                    ) : (
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{r.studentName}</span>
                    );
                  })()}
                </td>
                <td
                  className="sticky z-40 whitespace-nowrap bg-white px-3 py-2 text-slate-700 group-hover:bg-slate-50"
                  style={{
                    left: stickyGradeLeft,
                    width: STICKY_GRADE_WIDTH,
                    minWidth: STICKY_GRADE_WIDTH,
                    maxWidth: STICKY_GRADE_WIDTH,
                  }}
                >
                  {formatGradeDisplay(r.grade) || "—"}
                </td>
                <td
                  className="sticky z-40 whitespace-nowrap bg-white px-3 py-2 text-center text-slate-800 group-hover:bg-slate-50"
                  style={{
                    left: stickyAttendanceLeft,
                    width: STICKY_ATTENDANCE_WIDTH,
                    minWidth: STICKY_ATTENDANCE_WIDTH,
                    maxWidth: STICKY_ATTENDANCE_WIDTH,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={r.attended}
                    disabled={
                      attendanceLocked ||
                      !isAttendanceOrSummaryEditableForDate(r.dateIso) ||
                      isStudentSaving(r.studentId, r)
                    }
                    onChange={(event) => void onToggle(r, event.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-[#1d76c2] disabled:cursor-not-allowed"
                    aria-label={`Toggle attendance ${rowAriaStudentLabel(r)} ${r.dateDisplay} ${r.time}`}
                    suppressHydrationWarning
                  />
                  {savingStudentIds.has(r.studentId) ? (
                    <span className="mt-1 block text-[10px] font-medium text-amber-700">Saving…</span>
                  ) : savedFlashStudentIds.has(r.studentId) ? (
                    <span className="mt-1 block text-[10px] font-medium text-emerald-700">Saved</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-800">{r.dateDisplay}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{weekdayLabelFromIso(r.dateIso)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-800">{r.time}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.room}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                  <select
                    value={(() => {
                      const raw = r.tutor?.trim() ?? "";
                      if (!raw || raw === "—") return "TBD";
                      if (inactiveTutorNames.has(raw)) return "TBD";
                      const mapped = activeTutorAliasToNickname.get(raw);
                      return normalizeTutorLabel(mapped ?? raw);
                    })()}
                    disabled={
                      tutorFieldLocked || isStudentSaving(r.studentId, r)
                    }
                    onChange={(event) => void onChangeTutor(r, event.target.value)}
                    className="min-w-[120px] rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    aria-label={`${rowAriaStudentLabel(r)} tutor`}
                    suppressHydrationWarning
                  >
                    <option value="TBD">TBD</option>
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
                    disabled={summaryLocked || !isAttendanceOrSummaryEditableForDate(r.dateIso)}
                    aria-busy={savingLessonSummaryRowKey === r.rowKey}
                    placeholder={
                      restrictAttendanceAndSummaryToToday && !isAttendanceOrSummaryEditableForDate(r.dateIso)
                        ? "Only today's lessons can be edited"
                        : "Enter lesson summary"
                    }
                    onChange={(event) => {
                      if (!isAttendanceOrSummaryEditableForDate(r.dateIso)) return;
                      const nextValue = event.target.value;
                      setLocalRows((prev) =>
                        prev.map((row) => (row.rowKey === r.rowKey ? { ...row, note: nextValue } : row)),
                      );
                      scheduleLessonSummarySave(r, nextValue);
                    }}
                    className={[
                      "w-full max-w-[200px] resize-none rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
                      savingLessonSummaryRowKey === r.rowKey ? "opacity-90" : "",
                    ].join(" ")}
                    aria-label={`${rowAriaStudentLabel(r)} ${r.dateDisplay} lesson summary`}
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
                <td
                  className="max-w-[260px] whitespace-normal break-words px-3 py-2 text-xs text-slate-600"
                  title={examContentsByStudentId[r.studentId] || ""}
                >
                  {examContentsByStudentId[r.studentId] || "—"}
                </td>
                <td
                  className="max-w-[180px] whitespace-normal break-words px-3 py-2 text-xs text-slate-600"
                  title={r.textbookPublisher || ""}
                >
                  {r.textbookPublisher || "—"}
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
                    {lessonTypeLabel(r.lessonType)}
                  </span>
                </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sideScrollHeight > sideScrollClientHeight ? (
            <div className="border-l border-slate-200 bg-slate-50 px-2 py-2">
              <div
                ref={sideTrackRef}
                {...sideTrackA11yProps}
                className="relative w-2.5 select-none rounded bg-white ring-1 ring-slate-200"
                style={{ height: "calc(70vh - 16px)" }}
                onMouseDown={onSideTrackMouseDown}
              >
                <div
                  className="absolute left-0 right-0 rounded bg-slate-400/80 hover:bg-slate-500"
                  style={{ height: sideThumb.size, transform: `translateY(${sideThumb.offset}px)` }}
                  onMouseDown={startDragSideThumb}
                />
              </div>
            </div>
          ) : null}
        </div>

        {bottomScrollWidth > bottomScrollClientWidth ? (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2">
            <div
              ref={bottomTrackRef}
              {...bottomTrackA11yProps}
              className="relative h-2.5 select-none rounded bg-white ring-1 ring-slate-200"
              onMouseDown={onBottomTrackMouseDown}
            >
              <div
                className="absolute bottom-0 top-0 rounded bg-slate-400/80 hover:bg-slate-500"
                style={{ width: bottomThumb.size, transform: `translateX(${bottomThumb.offset}px)` }}
                onMouseDown={startDragBottomThumb}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
    </ClientOnlyAfterMount>
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
          aria-label={`Sort ${label}`}
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
