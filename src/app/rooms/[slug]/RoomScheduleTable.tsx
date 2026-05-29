"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { RoomScheduleRow } from "@/lib/roomScheduleAggregate";
import { normalizeStudentId } from "@/lib/studentId";
import {
  loadExamInfoBatch,
  loadLessonYearState,
  loadLessonYearStatesBatch,
  saveLessonYearState,
  type StudentLesson2026State,
} from "@/lib/studentLessonStorage";
import { loadTutorVisibility } from "@/lib/tutorVisibility";
import { isSharedIpadTutorDisplayName } from "@/lib/tutorConstants";
import { formatGradeDisplay } from "@/lib/grade";
import { useRoomLessonStateRealtime } from "@/lib/useRoomLessonStateRealtime";
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
  canOpenStudentLink?: boolean;
  /** 鎖定出席 checkbox */
  attendanceLocked?: boolean;
  /** 鎖定導師下拉 */
  tutorFieldLocked?: boolean;
  /** 導師帳：仍可改 Lesson summary（當 tutorFieldLocked 為 true 時） */
  allowSummaryEdit?: boolean;
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
  canOpenStudentLink = true,
  attendanceLocked = false,
  tutorFieldLocked = false,
  allowSummaryEdit = false,
  hideStudentId = false,
  studentLessonsHrefMode = "yearFromRoom",
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const summaryLocked = tutorFieldLocked && !allowSummaryEdit;
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
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null);
  const [savingLessonSummaryRowKey, setSavingLessonSummaryRowKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
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
  const initialNoteByRowKey = useRef(new Map<string, string>());
  const latestNoteByRowKeyRef = useRef(new Map<string, string>());
  const lessonSummarySaveTimersRef = useRef(new Map<string, number>());
  const lessonSummaryPendingRef = useRef(new Map<string, string>());
  const lessonSummaryInFlightRef = useRef(new Set<string>());
  const savingRowKeyRef = useRef<string | null>(null);
  const savingLessonSummaryRowKeyRef = useRef<string | null>(null);
  const examDateCache = useRef(new Map<string, string>());

  savingRowKeyRef.current = savingRowKey;
  savingLessonSummaryRowKeyRef.current = savingLessonSummaryRowKey;

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
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomTrackRef = useRef<HTMLDivElement | null>(null);
  const sideScrollRef = useRef<HTMLDivElement | null>(null);
  const sideTrackRef = useRef<HTMLDivElement | null>(null);
  const [bottomScrollWidth, setBottomScrollWidth] = useState(0);
  const [bottomScrollClientWidth, setBottomScrollClientWidth] = useState(0);
  const [sideScrollHeight, setSideScrollHeight] = useState(0);
  const [sideScrollClientHeight, setSideScrollClientHeight] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  function slotKey(r: Pick<RoomScheduleRow, "dateIso" | "time" | "room">) {
    return `${r.dateIso}__${r.time}__${r.room}`.toLowerCase();
  }

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

  useEffect(() => {
    setLocalRows(rows);
    for (const t of lessonSummarySaveTimersRef.current.values()) window.clearTimeout(t);
    lessonSummarySaveTimersRef.current.clear();
    lessonSummaryPendingRef.current.clear();
    initialNoteByRowKey.current = new Map(rows.map((r) => [r.rowKey, r.note]));
    latestNoteByRowKeyRef.current = new Map(rows.map((r) => [r.rowKey, r.note]));
  }, [rows]);

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
    const tableEl = tableScrollRef.current;
    const bottomEl = bottomScrollRef.current;
    const sideEl = sideScrollRef.current;
    if (!tableEl) return;

    let syncing = false;

    const updateMetrics = () => {
      setBottomScrollWidth(tableEl.scrollWidth);
      setBottomScrollClientWidth(tableEl.clientWidth);
      setSideScrollHeight(tableEl.scrollHeight);
      setSideScrollClientHeight(tableEl.clientHeight);
    };

    const onTableScroll = () => {
      if (syncing) return;
      syncing = true;
      setScrollLeft(tableEl.scrollLeft);
      setScrollTop(tableEl.scrollTop);
      syncing = false;
    };

    const onBottomScroll = () => {
      if (!bottomEl || syncing) return;
      syncing = true;
      tableEl.scrollLeft = bottomEl.scrollLeft;
      syncing = false;
    };

    const onSideScroll = () => {
      if (!sideEl || syncing) return;
      syncing = true;
      tableEl.scrollTop = sideEl.scrollTop;
      syncing = false;
    };

    updateMetrics();
    setScrollLeft(tableEl.scrollLeft);
    setScrollTop(tableEl.scrollTop);

    tableEl.addEventListener("scroll", onTableScroll, { passive: true });
    bottomEl?.addEventListener("scroll", onBottomScroll, { passive: true });
    sideEl?.addEventListener("scroll", onSideScroll, { passive: true });

    const ro = new ResizeObserver(() => updateMetrics());
    ro.observe(tableEl);

    return () => {
      tableEl.removeEventListener("scroll", onTableScroll);
      bottomEl?.removeEventListener("scroll", onBottomScroll);
      sideEl?.removeEventListener("scroll", onSideScroll);
      ro.disconnect();
    };
  }, [sortedLocalRows.length]);

  const bottomThumb = useMemo(() => {
    const trackEl = bottomTrackRef.current;
    const trackWidth = trackEl?.clientWidth ?? 0;
    if (!trackWidth || !bottomScrollWidth || !bottomScrollClientWidth) return { size: 0, offset: 0 };
    const ratio = bottomScrollClientWidth / bottomScrollWidth;
    const size = Math.max(28, Math.floor(trackWidth * ratio));
    const maxOffset = Math.max(0, trackWidth - size);
    const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);
    const offset = Math.round((scrollLeft / maxScroll) * maxOffset);
    return { size, offset };
  }, [bottomScrollClientWidth, bottomScrollWidth, scrollLeft]);

  const sideThumb = useMemo(() => {
    const trackEl = sideTrackRef.current;
    const trackHeight = trackEl?.clientHeight ?? 0;
    if (!trackHeight || !sideScrollHeight || !sideScrollClientHeight) return { size: 0, offset: 0 };
    const ratio = sideScrollClientHeight / sideScrollHeight;
    const size = Math.max(28, Math.floor(trackHeight * ratio));
    const maxOffset = Math.max(0, trackHeight - size);
    const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);
    const offset = Math.round((scrollTop / maxScroll) * maxOffset);
    return { size, offset };
  }, [sideScrollClientHeight, sideScrollHeight, scrollTop]);

  const onBottomTrackMouseDown = (e: React.MouseEvent) => {
    const track = bottomTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { size } = bottomThumb;
    const trackWidth = rect.width;
    const maxOffset = Math.max(0, trackWidth - size);
    const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);

    const targetOffset = Math.min(maxOffset, Math.max(0, x - size / 2));
    tableEl.scrollLeft = Math.round((targetOffset / Math.max(1, maxOffset)) * maxScroll);
  };

  const onSideTrackMouseDown = (e: React.MouseEvent) => {
    const track = sideTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const { size } = sideThumb;
    const trackHeight = rect.height;
    const maxOffset = Math.max(0, trackHeight - size);
    const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);

    const targetOffset = Math.min(maxOffset, Math.max(0, y - size / 2));
    tableEl.scrollTop = Math.round((targetOffset / Math.max(1, maxOffset)) * maxScroll);
  };

  const startDragBottomThumb = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = bottomTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const startX = e.clientX;
    const startOffset = bottomThumb.offset;
    const size = bottomThumb.size;
    const trackWidth = rect.width;
    const maxOffset = Math.max(0, trackWidth - size);
    const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const nextOffset = Math.min(maxOffset, Math.max(0, startOffset + dx));
      tableEl.scrollLeft = Math.round((nextOffset / Math.max(1, maxOffset)) * maxScroll);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startDragSideThumb = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = sideTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const startY = e.clientY;
    const startOffset = sideThumb.offset;
    const size = sideThumb.size;
    const trackHeight = rect.height;
    const maxOffset = Math.max(0, trackHeight - size);
    const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const nextOffset = Math.min(maxOffset, Math.max(0, startOffset + dy));
      tableEl.scrollTop = Math.round((nextOffset / Math.max(1, maxOffset)) * maxScroll);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

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
        if (cached !== undefined) nextDateMap[id] = cached;
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
        nextContentMap[id] = info.examContent;
      }
      const dateBatch: Record<string, string> = {};
      for (const [id, info] of Object.entries(batch)) dateBatch[id] = info.examDate ?? "";
      setExamDatesByStudentId((prev) => ({ ...prev, ...dateBatch }));
      setExamContentsByStudentId((prev) => ({ ...prev, ...nextContentMap }));
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
      setActiveTutorAliasToNickname(v.activeAliasToNickname);
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
      setSaveError(error instanceof Error ? error.message : "Failed to save attendance");
    } finally {
      setSavingRowKey(null);
    }
  }

  async function onChangeTutor(row: RoomScheduleRow, displayTutor: string) {
    setSaveError("");
    const slot = slotKey(row);
    setSavingRowKey(slot);
    const nextTutor = displayTutor.trim() || "TBD";
    const affected = localRows.filter((r) => slotKey(r) === slot);
    setLocalRows((prev) => prev.map((r) => (slotKey(r) === slot ? { ...r, tutor: nextTutor } : r)));

    try {
      const results = await Promise.all(
        affected.map(async (r) => {
          try {
            const current = await getStudentState(r.studentId);
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
            await saveLessonYearState(r.studentId, year, nextState);
            stateCache.current.set(r.studentId, nextState);
            return { ok: true as const };
          } catch (error) {
            return { ok: false as const, error };
          }
        }),
      );

      const failCount = results.filter((x) => !x.ok).length;
      if (failCount > 0) {
        setSaveError(`Failed to save tutor for ${failCount} student(s).`);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save tutor");
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
      setSaveError(error instanceof Error ? error.message : "Failed to save lesson summary");
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
    <ClientOnlyAfterMount fallback={<RoomScheduleTableSkeleton />}>
    <div>
      {saveError ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          Save failed: {saveError}
        </p>
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
              onChange={(e) => setAttendanceFilter(e.target.value as any)}
              className="h-8 min-w-[140px] rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            >
              <option value="all">All</option>
              <option value="attended">Attended</option>
              <option value="not_attended">Not attended</option>
            </select>
          </label>

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
                {sortedLocalRows.map((r, idx) => (
                  <tr key={`${r.rowKey}:${idx}`} className="group bg-white hover:bg-slate-50">
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
                      attendanceLocked || savingRowKey === r.rowKey || savingRowKey === slotKey(r)
                    }
                    onChange={(event) => void onToggle(r, event.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-[#1d76c2]"
                    aria-label={`Toggle attendance ${rowAriaStudentLabel(r)} ${r.dateDisplay} ${r.time}`}
                    suppressHydrationWarning
                  />
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
                      tutorFieldLocked || savingRowKey === r.rowKey || savingRowKey === slotKey(r)
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
                    disabled={summaryLocked}
                    aria-busy={savingLessonSummaryRowKey === r.rowKey}
                    placeholder="Enter lesson summary"
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setLocalRows((prev) =>
                        prev.map((row) => (row.rowKey === r.rowKey ? { ...row, note: nextValue } : row)),
                      );
                      scheduleLessonSummarySave(r, nextValue);
                    }}
                    className={[
                      "w-full max-w-[200px] resize-none rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]",
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
                ))}
              </tbody>
            </table>
          </div>

          {sideScrollHeight > sideScrollClientHeight ? (
            <div className="border-l border-slate-200 bg-slate-50 px-2 py-2">
              <div ref={sideScrollRef} className="sr-only" aria-hidden />
              <div
                ref={sideTrackRef}
                role="scrollbar"
                aria-label="Vertical scrollbar"
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
            <div ref={bottomScrollRef} className="sr-only" aria-hidden />
            <div
              ref={bottomTrackRef}
              role="scrollbar"
              aria-label="Horizontal scrollbar"
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
