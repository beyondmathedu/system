"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import { supabase } from "@/lib/supabase";
import { loadExamInfo, loadLessonYearState, saveLessonYearState } from "@/lib/studentLessonStorage";
import { readYmdParts } from "@/lib/intlFormatParts";
import { loadInactiveTutorNames } from "@/lib/tutorVisibility";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { isLegacyBmStudentId, normalizeStudentId } from "@/lib/studentId";
import { formatGradeDisplay } from "@/lib/grade";
import {
  getLessonSystemStartDate,
  getLessonSystemStartIso,
  isOnOrAfterLessonSystemStart,
  LESSON_SYSTEM_START_LABEL_ZH,
  LESSON_SYSTEM_START_MONTH,
  LESSON_SYSTEM_START_YEAR,
} from "@/lib/lessonSystemStart";
import {
  getActiveScheduleRulesForDate,
  isRegularLessonAttended,
  regularLessonAttendanceKey,
} from "@/lib/lessonScheduleVersions";
import {
  formatPendingMakeupReminder,
  isPendingRescheduleEntry,
  PENDING_MAKEUP_BUTTON_LABEL,
  PENDING_MAKEUP_TYPE_LABEL,
} from "@/lib/pendingMakeup";

const PRIMARY_GRADIENT = "linear-gradient(to right, #1d76c2 0%, #1d76c2 100%)";
const ROOM_OPTIONS = ["B", "M前", "M後", "Hope", "Hope 2"];
const ROOM_LABEL: Record<string, string> = {
  B: "B",
  M前: "M Front",
  M後: "M Back",
  Hope: "Hope",
  "Hope 2": "Hope 2",
};
const WEEKDAY_LABEL: Record<string, string> = {
  一: "Mon",
  二: "Tue",
  三: "Wed",
  四: "Thu",
  五: "Fri",
  六: "Sat",
  日: "Sun",
};
const WEEKDAY_TIME_SUGGESTIONS = ["03:00 PM", "04:30 PM", "06:00 PM"];
const SATURDAY_TIME_SUGGESTIONS = ["10:00 AM", "11:30 AM", "01:00 PM", "02:30 PM"];
const TYPE_REGULAR = "Regular";
const TYPE_CANCELLED = "Cancelled";
const TYPE_RESCHEDULE = "Reschedule";
const TYPE_PENDING = PENDING_MAKEUP_TYPE_LABEL;
const TYPE_EXTRA = "Extra";
const MONTH_LABEL: Record<number, string> = {
  1: "Jan",
  2: "Feb",
  3: "Mar",
  4: "Apr",
  5: "May",
  6: "Jun",
  7: "Jul",
  8: "Aug",
  9: "Sep",
  10: "Oct",
  11: "Nov",
  12: "Dec",
};

function isDoubleReschedulePairId(id: unknown): boolean {
  return String(id ?? "").endsWith("-double-reschedule");
}

type StudentSummary = {
  id: string;
  nameZh: string;
  nameEn: string;
  nicknameEn: string;
  grade: string;
  school: string;
  textbookPublisher: string;
};

type ScheduleRecord = {
  id: string;
  /** YYYY-MM-DD：自該日起適用此筆星期／時間／房間（舊資料會用 createdAt 香港日還原） */
  effectiveDate?: string;
  weekday: string; // 一..六,日
  time: string;
  room: string;
  tutor?: string;
  lessonSummary?: string;
  lessonType?: string;
  createdAt: number;
};

type DayOverride = {
  time?: string;
  room?: string;
  tutor?: string;
  lessonSummary?: string;
  lessonType?: string;
};

type ScheduleRow = {
  month: number;
  lLabel: string;
  date: string;
  weekday: string;
  /** 時段設定（未套用調堂覆寫） */
  baseTime: string;
  baseRoom: string;
  /** 調堂：原本日期（from），用於顯示 from → to */
  rescheduleFromDate?: string;
  time: string;
  room: string;
  tutor: string;
  lessonSummary: string;
  lessonType: string;
  rowKind: "normal" | "cancelled_original" | "reschedule";
  /** 列勾選、React key */
  rowId: string;
  /** localStorage 出席鍵（調堂列用 reschedule:id 避免同日兩筆衝突） */
  attendanceKey: string;
  /** 預設列順序（調堂插入在原列下方） */
  displayOrder: number;
  rescheduleEntryId?: string;
  extraEntryId?: string;
  pendingMakeupLabel?: string;
};

type RescheduleEntry = {
  id: string;
  fromDate: string;
  toDate: string;
  time: string;
  room: string;
  pending?: boolean;
};

type ExtraEntry = {
  id: string;
  date: string;
  time: string;
  room: string;
};

type SortDirection = "asc" | "desc";
type ScheduleSortKey =
  | "month"
  | "lLabel"
  | "attendance"
  | "date"
  | "weekday"
  | "time"
  | "room"
  | "tutor"
  | "lessonSummary"
  | "lessonType";
type ScheduleSortConfig = { key: ScheduleSortKey; direction: SortDirection } | null;

function numberToWeekday(num: number) {
  switch (num) {
    case 1:
      return "一";
    case 2:
      return "二";
    case 3:
      return "三";
    case 4:
      return "四";
    case 5:
      return "五";
    case 6:
      return "六";
    case 7:
      return "日";
    default:
      return "";
  }
}

function toIsoDate(d: Date) {
  // YYYY-MM-DD（避免本地时区导致日期偏移）
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toHkIsoDateFromMs(ms: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));

  const { y, m, d } = readYmdParts(parts);
  return `${y}-${m}-${d}`;
}

function getHkWeekdayNumber(d: Date) {
  // HK：Mon=1..Sun=7
  const js = d.getDay(); // Sun=0..Sat=6
  return js === 0 ? 7 : js;
}

function weekdayFromIsoDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mm - 1, d);
  const hkNum = getHkWeekdayNumber(dt);
  return numberToWeekday(hkNum);
}

export function StudentLessonsYearPage({ targetYear = 2026 }: { targetYear?: number }) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const rawId = String(params?.id || "");
  const studentId = normalizeStudentId(rawId);
  const [studentSummary, setStudentSummary] = useState<StudentSummary>({
    id: studentId,
    nameZh: "",
    nameEn: "",
    nicknameEn: "",
    grade: "",
    school: "",
    textbookPublisher: "",
  });
  const [examInfo, setExamInfo] = useState<{ examDate: string; examContent: string }>({
    examDate: "",
    examContent: "",
  });
  const [studentLoaded, setStudentLoaded] = useState(false);
  const [studentNotFound, setStudentNotFound] = useState(false);
  const [accessReady, setAccessReady] = useState(false);

  const [records, setRecords] = useState<ScheduleRecord[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const ATTENDANCE_STORAGE_KEY = `attendance:${studentId}:${targetYear}`;

  useEffect(() => {
    let mounted = true;
    async function checkAccess() {
      if (rawId && isLegacyBmStudentId(rawId)) {
        router.replace(`/students/${encodeURIComponent(normalizeStudentId(rawId))}/lessons/${targetYear}`);
        return;
      }
      const nextPath = `/students/${encodeURIComponent(studentId)}/lessons/${targetYear}`;
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        window.location.href = `/login?next=${encodeURIComponent(nextPath)}`;
        return;
      }
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role, student_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const role = String((profile as any)?.role ?? "").toLowerCase();
      const ownStudentId = normalizeStudentId(String((profile as any)?.student_id ?? ""));
      if (role === "student" && ownStudentId && ownStudentId !== studentId) {
        router.replace(`/students/${encodeURIComponent(ownStudentId)}/lessons/2026`);
        return;
      }
      if (role === "tutor") {
        router.replace("/daily-time-table");
        return;
      }
      if (mounted) setAccessReady(true);
    }
    void checkAccess();
    return () => {
      mounted = false;
    };
  }, [rawId, studentId, targetYear, router]);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [hiddenDates, setHiddenDates] = useState<Record<string, boolean>>({});
  const HIDDEN_DATES_STORAGE_KEY = `hidden_dates:${studentId}:${targetYear}`;
  const [overrides, setOverrides] = useState<Record<string, DayOverride>>({});
  const OVERRIDES_STORAGE_KEY = `overrides:${studentId}:${targetYear}`;
  const overridesRef = useRef<Record<string, DayOverride>>({});
  const attendanceRef = useRef<Record<string, boolean>>({});
  const hiddenDatesRef = useRef<Record<string, boolean>>({});
  const rescheduleEntriesRef = useRef<RescheduleEntry[]>([]);
  const extraEntriesRef = useRef<ExtraEntry[]>([]);

  // 用於輸入時避免每次 setOverrides 都造成 textarea 光標抖動
  const [lessonSummaryDraftByDateIso, setLessonSummaryDraftByDateIso] = useState<
    Record<string, string>
  >({});
  const lessonSummaryDraftByDateIsoRef = useRef<Record<string, string>>({});
  const lessonSummarySaveTimersRef = useRef<Map<string, number>>(new Map());
  const [rescheduleEntries, setRescheduleEntries] = useState<RescheduleEntry[]>([]);
  const RESCHEDULE_STORAGE_KEY = `reschedule:${studentId}:${targetYear}`;
  const [extraEntries, setExtraEntries] = useState<ExtraEntry[]>([]);
  const EXTRA_STORAGE_KEY = `extra_lessons:${studentId}:${targetYear}`;
  const [editingRescheduleId, setEditingRescheduleId] = useState<string | null>(null);
  const [fromLessonDate, setFromLessonDate] = useState<string>("");
  const [toLessonDate, setToLessonDate] = useState<string>("");
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [reschedulePanelMode, setReschedulePanelMode] = useState<"reschedule" | "pending">("reschedule");
  const [showExtraPanel, setShowExtraPanel] = useState(false);
  const [lockFromLessonDate, setLockFromLessonDate] = useState(false);
  const [extraForm, setExtraForm] = useState<{
    date: string;
    timePreset: string;
    timeCustom: string;
    room: string;
    doubleEnabled: boolean;
  }>({
    date: "",
    timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
    timeCustom: "",
    room: ROOM_OPTIONS[0],
    doubleEnabled: false,
  });
  const [editForm, setEditForm] = useState<{
    timePreset: string;
    timeCustom: string;
    room: string;
    doubleEnabled: boolean;
  }>({
    timePreset: "",
    timeCustom: "",
    room: "",
    doubleEnabled: false,
  });
  const [selectionError, setSelectionError] = useState("");
  const [editSaveStatus, setEditSaveStatus] = useState("");
  const [extraSaveStatus, setExtraSaveStatus] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterTime, setFilterTime] = useState("");
  const [filterRoom, setFilterRoom] = useState("");
  const [filterTutor, setFilterTutor] = useState("");
  const [filterType, setFilterType] = useState("");
  const [sortConfig, setSortConfig] = useState<ScheduleSortConfig>(null);
  const [inactiveTutorNames, setInactiveTutorNames] = useState<Set<string>>(new Set());
  const yearMin = getLessonSystemStartIso(targetYear);
  const yearMax = `${targetYear}-12-31`;

  function displayTutorInCell(raw: string): string {
    const t = raw.trim();
    if (!t) return "—";
    if (inactiveTutorNames.has(t)) return "—";
    return t;
  }

  function persistYearState(next: {
    attendance?: Record<string, boolean>;
    hiddenDates?: Record<string, boolean>;
    overrides?: Record<string, DayOverride>;
    rescheduleEntries?: RescheduleEntry[];
    extraEntries?: ExtraEntry[];
  }) {
    if (!studentId) return;
    void saveLessonYearState(studentId, targetYear, {
      attendance: next.attendance ?? attendance,
      hiddenDates: next.hiddenDates ?? hiddenDates,
      overrides: next.overrides ?? overrides,
      rescheduleEntries: next.rescheduleEntries ?? rescheduleEntries,
      extraEntries: next.extraEntries ?? extraEntries,
    });
  }

  useEffect(() => {
    overridesRef.current = overrides;
    attendanceRef.current = attendance;
    hiddenDatesRef.current = hiddenDates;
    rescheduleEntriesRef.current = rescheduleEntries;
    extraEntriesRef.current = extraEntries;
    lessonSummaryDraftByDateIsoRef.current = lessonSummaryDraftByDateIso;
  }, [attendance, hiddenDates, overrides, rescheduleEntries, extraEntries, lessonSummaryDraftByDateIso]);

  useEffect(() => {
    const timersMap = lessonSummarySaveTimersRef.current;
    return () => {
      // component unmount safety: clear any pending debounced saves
      for (const t of timersMap.values()) window.clearTimeout(t);
      timersMap.clear();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const names = await loadInactiveTutorNames();
      if (mounted) setInactiveTutorNames(names);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!studentId) return;
    const timer = window.setTimeout(() => {
      setStudentLoaded(false);
      setStudentNotFound(false);
      void (async () => {
        const { data } = await supabase
          .from("students")
          .select("id, name_zh, name_en, nickname_en, grade, school, textbook_publisher")
          .eq("id", studentId)
          .maybeSingle();
        if (!data) {
          setStudentSummary({
            id: studentId,
            nameZh: "",
            nameEn: "",
            nicknameEn: "",
            grade: "",
            school: "",
            textbookPublisher: "",
          });
          setStudentNotFound(true);
          setStudentLoaded(true);
          return;
        }
        setStudentSummary({
          id: data.id,
          nameZh: data.name_zh ?? "",
          nameEn: data.name_en ?? "",
          nicknameEn: data.nickname_en ?? "",
          grade: data.grade ?? "",
          school: data.school ?? "",
          textbookPublisher: data.textbook_publisher ?? "",
        });
        setStudentLoaded(true);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const info = await loadExamInfo(studentId);
        setExamInfo(info);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    try {
      const key = `lesson_schedule_records:${studentId}`;
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ScheduleRecord[];
      if (Array.isArray(parsed)) {
        const timer = window.setTimeout(() => {
          setRecords(parsed);
        }, 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      // ignore
    }
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    try {
      const raw = window.localStorage.getItem(ATTENDANCE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed && typeof parsed === "object") {
        const timer = window.setTimeout(() => {
          setAttendance(parsed);
        }, 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      // ignore
    }
  }, [studentId, ATTENDANCE_STORAGE_KEY]);

  useEffect(() => {
    if (!studentId) return;
    try {
      const raw = window.localStorage.getItem(HIDDEN_DATES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed && typeof parsed === "object") {
        const timer = window.setTimeout(() => setHiddenDates(parsed), 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      // ignore
    }
  }, [studentId, HIDDEN_DATES_STORAGE_KEY]);

  useEffect(() => {
    if (!studentId) return;
    try {
      const raw = window.localStorage.getItem(OVERRIDES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, DayOverride>;
      if (parsed && typeof parsed === "object") {
        const timer = window.setTimeout(() => setOverrides(parsed), 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      // ignore
    }
  }, [studentId, OVERRIDES_STORAGE_KEY]);

  useEffect(() => {
    if (!studentId) return;
    try {
      const raw = window.localStorage.getItem(RESCHEDULE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as RescheduleEntry[];
      if (Array.isArray(parsed)) {
        const timer = window.setTimeout(() => setRescheduleEntries(parsed), 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      // ignore
    }
  }, [studentId, RESCHEDULE_STORAGE_KEY]);

  useEffect(() => {
    if (!studentId) return;
    try {
      const raw = window.localStorage.getItem(EXTRA_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ExtraEntry[];
      if (Array.isArray(parsed)) {
        const timer = window.setTimeout(() => setExtraEntries(parsed), 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      // ignore
    }
  }, [studentId, EXTRA_STORAGE_KEY]);

  useEffect(() => {
    if (!studentId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const cloud = await loadLessonYearState(studentId, targetYear);

        setAttendance(cloud.attendance as Record<string, boolean>);
        setHiddenDates(cloud.hiddenDates as Record<string, boolean>);
        setOverrides(cloud.overrides as Record<string, DayOverride>);
        setRescheduleEntries(cloud.rescheduleEntries as RescheduleEntry[]);
        setExtraEntries(cloud.extraEntries as ExtraEntry[]);

        window.localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(cloud.attendance));
        window.localStorage.setItem(HIDDEN_DATES_STORAGE_KEY, JSON.stringify(cloud.hiddenDates));
        window.localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(cloud.overrides));
        window.localStorage.setItem(
          RESCHEDULE_STORAGE_KEY,
          JSON.stringify(cloud.rescheduleEntries),
        );
        window.localStorage.setItem(EXTRA_STORAGE_KEY, JSON.stringify(cloud.extraEntries));
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    studentId,
    targetYear,
    ATTENDANCE_STORAGE_KEY,
    HIDDEN_DATES_STORAGE_KEY,
    OVERRIDES_STORAGE_KEY,
    RESCHEDULE_STORAGE_KEY,
    EXTRA_STORAGE_KEY,
  ]);

  const baseScheduleRows = useMemo(() => {
    if (!studentId) return [];

    const normalized = records.map((r) => ({
      ...r,
      effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
    }));
    const sortedRules = [...normalized].sort((a, b) => {
      const ed = a.effectiveDate.localeCompare(b.effectiveDate);
      if (ed !== 0) return ed;
      return a.createdAt - b.createdAt;
    });
    const start = getLessonSystemStartDate(targetYear);
    const end = new Date(targetYear, 11, 31);

    const monthCounter: Record<number, number> = {};
    const rows: ScheduleRow[] = [];
    const versionCache = new Map<string, (typeof sortedRules)[0][]>();

    for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      const hkNum = getHkWeekdayNumber(cur);
      const weekday = numberToWeekday(hkNum);
      const dateIso = toIsoDate(cur);
      const activeRules = getActiveScheduleRulesForDate(sortedRules, dateIso, versionCache);
      for (const rec of activeRules) {
        if (rec.weekday !== weekday) continue;

        const month = cur.getMonth() + 1;
        monthCounter[month] = (monthCounter[month] ?? 0) + 1;
        const attendanceKey = regularLessonAttendanceKey(rec, dateIso);
        rows.push({
          month,
          lLabel: `L${monthCounter[month]}`,
          date: dateIso,
          weekday,
          baseTime: rec.time.toString(),
          baseRoom: rec.room.toString(),
          time: (overrides[dateIso]?.time ?? rec.time).toString(),
          room: (overrides[dateIso]?.room ?? rec.room).toString(),
          tutor: (overrides[dateIso]?.tutor ?? rec.tutor ?? "").toString(),
          lessonSummary: (overrides[dateIso]?.lessonSummary ?? rec.lessonSummary ?? "").toString(),
          lessonType: TYPE_REGULAR,
          rowKind: "normal",
          rowId: `${dateIso}-regular-${rec.id}`,
          attendanceKey,
          displayOrder: 0,
        });
      }
    }

    return rows.filter((r) => !hiddenDates[r.date]);
  }, [records, studentId, overrides, hiddenDates, targetYear]);

  const baseRowByDate = useMemo(() => {
    const map = new Map<string, ScheduleRow>();
    for (const r of baseScheduleRows) {
      if (!map.has(r.date)) map.set(r.date, r);
    }
    return map;
  }, [baseScheduleRows]);

  const rescheduleEntryById = useMemo(() => {
    const map = new Map<string, RescheduleEntry>();
    for (const e of rescheduleEntries) map.set(e.id, e);
    return map;
  }, [rescheduleEntries]);

  const rescheduleIdsByFromDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of rescheduleEntries) {
      const list = map.get(e.fromDate);
      if (list) list.push(e.id);
      else map.set(e.fromDate, [e.id]);
    }
    return map;
  }, [rescheduleEntries]);

  const rescheduleEntryByFromDate = useMemo(() => {
    const map = new Map<string, RescheduleEntry>();
    for (const e of rescheduleEntries) {
      if (!map.has(e.fromDate)) map.set(e.fromDate, e);
    }
    return map;
  }, [rescheduleEntries]);

  const hkTodayYmd = useMemo(() => toHkIsoDateFromMs(Date.now()), []);

  const scheduleRows = useMemo(() => {
    if (!studentId) return [];

    let rows: ScheduleRow[] = [];
    const baseDates = new Set(baseScheduleRows.map((r) => r.date));
    for (const r of baseScheduleRows) {
      const e = rescheduleEntryByFromDate.get(r.date);
      if (!e) {
        rows.push({ ...r });
        continue;
      }
      if (isPendingRescheduleEntry(e)) {
        const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.fromDate);
        const fromMonth = parts ? Number(parts[2]) : r.month;
        rows.push({
          ...r,
          month: fromMonth,
          lessonType: TYPE_PENDING,
          rowKind: "cancelled_original",
          rowId: `pending-${e.id}`,
          attendanceKey: `cancelled:${e.fromDate}:${e.id}`,
          lLabel: "/",
          pendingMakeupLabel: formatPendingMakeupReminder(e.fromDate, hkTodayYmd),
          rescheduleEntryId: e.id,
        });
        continue;
      }
      if (!isOnOrAfterLessonSystemStart(e.toDate, targetYear)) {
        rows.push({ ...r });
        continue;
      }

      const toWd = weekdayFromIsoDate(e.toDate);
      const toParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.toDate);
      const toMonth = toParts ? Number(toParts[2]) : 1;

      const rescheduleRow: ScheduleRow = {
        month: toMonth,
        lLabel: "L0",
        date: e.toDate,
        weekday: toWd,
        baseTime: r.baseTime,
        baseRoom: r.baseRoom,
        rescheduleFromDate: e.fromDate,
        time: e.time,
        room: e.room,
        tutor: "",
        lessonSummary: "",
        lessonType: TYPE_RESCHEDULE,
        rowKind: "reschedule",
        rowId: `reschedule-${e.id}`,
        attendanceKey: `reschedule:${e.id}`,
        displayOrder: 0,
        rescheduleEntryId: e.id,
      };

      rows.push(rescheduleRow);
    }

    for (const e of rescheduleEntries) {
      if (isPendingRescheduleEntry(e)) continue;
      if (!isOnOrAfterLessonSystemStart(e.toDate, targetYear)) continue;
      if (baseDates.has(e.fromDate)) continue;
      const toWd = weekdayFromIsoDate(e.toDate);
      const toParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.toDate);
      const toMonth = toParts ? Number(toParts[2]) : 1;
      rows.push({
        month: toMonth,
        lLabel: "L0",
        date: e.toDate,
        weekday: toWd,
        baseTime: e.time,
        baseRoom: e.room,
        rescheduleFromDate: e.fromDate,
        time: e.time,
        room: e.room,
        tutor: "",
        lessonSummary: "",
        lessonType: TYPE_RESCHEDULE,
        rowKind: "reschedule",
        rowId: `reschedule-${e.id}`,
        attendanceKey: `reschedule:${e.id}`,
        displayOrder: 0,
        rescheduleEntryId: e.id,
      });
    }

    for (const e of extraEntries) {
      if (!isOnOrAfterLessonSystemStart(e.date, targetYear)) continue;
      const wd = weekdayFromIsoDate(e.date);
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
      const month = parts ? Number(parts[2]) : 1;
      rows.push({
        month,
        lLabel: "L0",
        date: e.date,
        weekday: wd,
        baseTime: e.time,
        baseRoom: e.room,
        time: e.time,
        room: e.room,
        tutor: "",
        lessonSummary: "",
        lessonType: TYPE_EXTRA,
        rowKind: "normal",
        rowId: `extra-${e.id}`,
        attendanceKey: `extra:${e.id}`,
        displayOrder: 0,
        extraEntryId: e.id,
      });
    }

    rows = rows.filter((r) => isOnOrAfterLessonSystemStart(r.date, targetYear));

    rows.sort((a, b) => {
      const dc = a.date.localeCompare(b.date);
      if (dc !== 0) return dc;
      const tc = a.time.localeCompare(b.time, "en", { numeric: true });
      if (tc !== 0) return tc;
      return a.rowId.localeCompare(b.rowId);
    });

    const autoDoubleKeys = new Set<string>();
    for (const r of rows) {
      if (r.extraEntryId && isDoubleReschedulePairId(r.extraEntryId)) {
        autoDoubleKeys.add(`${r.date}|${r.time}|${r.room}`);
      }
    }

    const monthCounter: Record<number, number> = {};
    rows = rows.map((r, i) => {
      if (r.rowKind === "cancelled_original") {
        return { ...r, lLabel: "/", displayOrder: i };
      }
      const rowKey = `${r.date}|${r.time}|${r.room}`;
      if (r.extraEntryId && isDoubleReschedulePairId(r.extraEntryId)) {
        // Auto-generated pair row for reschedule double lesson: do not count again.
        return { ...r, lLabel: "/", displayOrder: i };
      }
      if (r.rowKind === "reschedule" && autoDoubleKeys.has(rowKey)) {
        const start = (monthCounter[r.month] ?? 0) + 1;
        monthCounter[r.month] = start + 1;
        return { ...r, lLabel: `L${start} / L${start + 1}`, displayOrder: i };
      }
      monthCounter[r.month] = (monthCounter[r.month] ?? 0) + 1;
      return { ...r, lLabel: `L${monthCounter[r.month]}`, displayOrder: i };
    });
    return rows;
  }, [
    baseScheduleRows,
    studentId,
    targetYear,
    rescheduleEntryByFromDate,
    rescheduleEntries,
    extraEntries,
    hkTodayYmd,
  ]);

  const scheduleRowById = useMemo(() => {
    const map = new Map<string, ScheduleRow>();
    for (const r of scheduleRows) map.set(r.rowId, r);
    return map;
  }, [scheduleRows]);

  const sortedScheduleRows = useMemo(() => {
    const copied = [...scheduleRows];
    if (!sortConfig) {
      copied.sort((a, b) => a.displayOrder - b.displayOrder);
      return copied;
    }

    const weekdayOrder: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      日: 7,
    };

    copied.sort((a, b) => {
      let result = 0;
      const { key } = sortConfig;

      switch (key) {
        case "month":
          result = a.month - b.month;
          break;
        case "lLabel": {
          const na = Number.parseInt(a.lLabel.replace(/\D/g, ""), 10) || 0;
          const nb = Number.parseInt(b.lLabel.replace(/\D/g, ""), 10) || 0;
          result = na - nb;
          break;
        }
        case "attendance":
          result =
            (attendance[a.attendanceKey] ? 1 : 0) -
            (attendance[b.attendanceKey] ? 1 : 0);
          break;
        case "date":
          result = a.date.localeCompare(b.date);
          break;
        case "weekday":
          result =
            (weekdayOrder[a.weekday] ?? 99) - (weekdayOrder[b.weekday] ?? 99);
          break;
        case "time":
          result = a.time.localeCompare(b.time, "en", { numeric: true });
          break;
        case "room":
          result = a.room.localeCompare(b.room, "zh-Hant");
          break;
        case "tutor":
          result = a.tutor.localeCompare(b.tutor, "zh-Hant");
          break;
        case "lessonSummary":
          result = a.lessonSummary.localeCompare(b.lessonSummary, "zh-Hant");
          break;
        case "lessonType":
          result = a.lessonType.localeCompare(b.lessonType, "zh-Hant");
          break;
        default:
          result = 0;
      }

      return sortConfig.direction === "asc" ? result : -result;
    });

    return copied;
  }, [scheduleRows, attendance, sortConfig]);

  const selectedRowIdSet = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);

  const monthFilterOptions = useMemo(
    () => [...new Set(scheduleRows.map((r) => r.month))].sort((a, b) => a - b),
    [scheduleRows],
  );
  const roomFilterOptions = useMemo(
    () => [...new Set(scheduleRows.map((r) => r.room).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [scheduleRows],
  );
  const tutorFilterOptions = useMemo(
    () =>
      [...new Set(scheduleRows.map((r) => r.tutor.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [scheduleRows],
  );
  const typeFilterOptions = useMemo(
    () =>
      [...new Set(scheduleRows.map((r) => r.lessonType).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [scheduleRows],
  );

  const filteredScheduleRows = useMemo(() => {
    const timeKeyword = filterTime.trim().toLowerCase();
    return sortedScheduleRows.filter((r) => {
      if (filterMonth && String(r.month) !== filterMonth) return false;
      if (filterDateFrom && r.date < filterDateFrom) return false;
      if (filterDateTo && r.date > filterDateTo) return false;
      if (timeKeyword && !r.time.toLowerCase().includes(timeKeyword)) return false;
      if (filterRoom && r.room !== filterRoom) return false;
      if (filterTutor && r.tutor.trim() !== filterTutor) return false;
      if (filterType && r.lessonType !== filterType) return false;
      return true;
    });
  }, [
    sortedScheduleRows,
    filterMonth,
    filterDateFrom,
    filterDateTo,
    filterTime,
    filterRoom,
    filterTutor,
    filterType,
  ]);

  const allVisibleSelected =
    filteredScheduleRows.length > 0 &&
    filteredScheduleRows.every((r) => selectedRowIdSet.has(r.rowId));

  const editWeekday = useMemo(
    () => (toLessonDate ? weekdayFromIsoDate(toLessonDate) : ""),
    [toLessonDate],
  );
  const editTimeOptions = useMemo(() => {
    if (editWeekday === "六") return SATURDAY_TIME_SUGGESTIONS;
    return WEEKDAY_TIME_SUGGESTIONS;
  }, [editWeekday]);

  function applyEditDefaultsForDate(iso: string) {
    const wd = weekdayFromIsoDate(iso);
    const opts = wd === "六" ? SATURDAY_TIME_SUGGESTIONS : WEEKDAY_TIME_SUGGESTIONS;
    const row = baseRowByDate.get(iso);
    setEditForm((prev) => {
      const effectiveTime = row?.time ?? "";
      const timePreset =
        row && opts.includes(effectiveTime)
          ? effectiveTime
          : opts.includes(prev.timePreset)
            ? prev.timePreset
            : opts[0];
      const room =
        row && ROOM_OPTIONS.includes(row.room)
          ? row.room
          : ROOM_OPTIONS.includes(prev.room)
            ? prev.room
            : ROOM_OPTIONS[0];
      return {
        ...prev,
        timePreset,
        timeCustom: "",
        room,
      };
    });
  }

  const editOriginalLesson = useMemo(() => {
    if (!fromLessonDate) {
      return { kind: "empty" as const };
    }
    const row = baseRowByDate.get(fromLessonDate);
    if (!row) {
      return { kind: "noRow" as const, date: fromLessonDate };
    }
    const hasOverride = Boolean(overrides[fromLessonDate]);
    return {
      kind: "row" as const,
      date: row.date,
      weekday: row.weekday,
      baseTime: row.baseTime,
      baseRoom: row.baseRoom,
      displayTime: row.time,
      displayRoom: row.room,
      hasOverride,
    };
  }, [fromLessonDate, baseRowByDate, overrides]);

  const LESSON_SUMMARY_SAVE_DEBOUNCE_MS = 600;

  function queueLessonSummarySave(dateIso: string) {
    const existing = lessonSummarySaveTimersRef.current.get(dateIso);
    if (existing) window.clearTimeout(existing);

    const timer = window.setTimeout(() => {
      lessonSummarySaveTimersRef.current.delete(dateIso);
      void (async () => {
        if (!studentId) return;
        try {
          await saveLessonYearState(studentId, targetYear, {
            attendance: attendanceRef.current,
            hiddenDates: hiddenDatesRef.current,
            overrides: overridesRef.current,
            rescheduleEntries: rescheduleEntriesRef.current,
            extraEntries: extraEntriesRef.current,
          });
        } catch {
          // 失敗就不影響 UI（之後刷新/再次編輯仍可重試）
        }
      })();
    }, LESSON_SUMMARY_SAVE_DEBOUNCE_MS);

    lessonSummarySaveTimersRef.current.set(dateIso, timer);
  }

  function handleLessonSummaryDraftChange(dateIso: string, nextText: string) {
    lessonSummaryDraftByDateIsoRef.current[dateIso] = nextText;
    setLessonSummaryDraftByDateIso((prev) => ({ ...prev, [dateIso]: nextText }));

    const baseOverrides = overridesRef.current;
    const nextOverrides: Record<string, DayOverride> = {
      ...baseOverrides,
      [dateIso]: {
        ...(baseOverrides[dateIso] ?? {}),
        lessonSummary: nextText,
      },
    };
    overridesRef.current = nextOverrides;
    setOverrides(nextOverrides);

    // 讓使用者不必等待雲端回應，也能在刷新後保留輸入
    try {
      window.localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(nextOverrides));
    } catch {
      // ignore
    }

    queueLessonSummarySave(dateIso);
  }

  if (!accessReady) {
    return (
      <div className="min-h-screen bg-slate-100 py-10">
        <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
          <AppTopNav highlight="students" />
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Verifying account access...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="students" />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <div className="flex items-center gap-3">
              <Link
                href={`/students/${studentId}/lessons`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xl font-bold leading-none hover:bg-white/30"
                aria-label="Back to student lessons"
              >
                ←
              </Link>
              <h1 className="text-2xl font-bold tracking-tight">Student Lesson Record</h1>
            </div>

            <p className="mt-1 text-sm text-blue-100">
              Student ID: {studentId || "—"} | Student:{" "}
              {formatStudentDisplayNameOrEmpty(
                {
                  id: studentSummary.id,
                  name_zh: studentSummary.nameZh,
                  name_en: studentSummary.nameEn,
                  nickname_en: studentSummary.nicknameEn,
                },
                "full",
                "—",
              )}
            </p>
          </div>

          {studentLoaded && studentNotFound && (
            <div className="mx-6 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Student record {studentId} was not found. You can still edit {targetYear} lesson records, but we recommend adding this student in the Students page first.
            </div>
          )}

          <div className="border-b border-slate-200 bg-slate-50 p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                <p className="text-xs font-semibold tracking-wider text-slate-500">Student ID</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentId || "—"}</p>
                </div>
                <div className="md:col-span-2">
                <p className="text-xs font-semibold tracking-wider text-slate-500">Student Name</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {formatStudentDisplayNameOrEmpty(
                      {
                        id: studentSummary.id,
                        name_zh: studentSummary.nameZh,
                        name_en: studentSummary.nameEn,
                        nickname_en: studentSummary.nicknameEn,
                      },
                      "full",
                    )}
                  </p>
                </div>
                <div>
                <p className="text-xs font-semibold tracking-wider text-slate-500">Grade</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{formatGradeDisplay(studentSummary.grade) || "—"}</p>
                </div>
                <div className="md:col-span-2">
                <p className="text-xs font-semibold tracking-wider text-slate-500">School</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.school || "—"}</p>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <p className="text-xs font-semibold tracking-wider text-slate-500">Latest Exam Date</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{examInfo.examDate || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wider text-slate-500">Exam Content</p>
                    <p className="mt-1 text-sm font-bold text-slate-900 break-words">{examInfo.examContent || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wider text-slate-500">Textbook publisher</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.textbookPublisher || "—"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <h2 className="text-lg font-bold text-slate-900">{targetYear} Lesson Records</h2>
            {targetYear === LESSON_SYSTEM_START_YEAR ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                網站由 {LESSON_SYSTEM_START_LABEL_ZH} 起管理課表；{LESSON_SYSTEM_START_MONTH - 1}{" "}
                月及之前之 Excel 紀錄不會顯示於此。
              </p>
            ) : null}

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-700">
                  Selected: <span className="font-bold text-slate-900">{selectedRowIds.length}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRowIds.length > 1) {
                        setSelectionError("For reschedule, select only 1 row for prefill, or clear selection and enter original lesson date manually.");
                        return;
                      }
                      setShowExtraPanel(false);
                      setReschedulePanelMode("reschedule");
                      setSelectionError("");
                      if (selectedRowIds.length === 1) {
                        const row = scheduleRowById.get(selectedRowIds[0]);
                        if (!row) {
                          setSelectionError("Cannot find the row to edit.");
                          return;
                        }
                        if (row.rowKind === "normal") {
                          setEditingRescheduleId(null);
                          setFromLessonDate(row.date);
                          setToLessonDate(row.date);
                          setLockFromLessonDate(true);
                          const wd = weekdayFromIsoDate(row.date);
                          const opts =
                            wd === "六"
                              ? SATURDAY_TIME_SUGGESTIONS
                              : WEEKDAY_TIME_SUGGESTIONS;
                          const timePreset =
                            opts.includes(row.time) ? row.time : opts[0];
                          setEditForm({
                            timePreset,
                            timeCustom: "",
                            room: ROOM_OPTIONS.includes(row.room)
                              ? row.room
                              : ROOM_OPTIONS[0],
                            doubleEnabled: false,
                          });
                          setShowEditPanel(true);
                          return;
                        }

                        if (!row.rescheduleEntryId) {
                          setSelectionError("This row has no editable reschedule record.");
                          return;
                        }
                        const entry = rescheduleEntryById.get(row.rescheduleEntryId);
                        if (!entry) {
                          setSelectionError("Cannot find the corresponding reschedule record.");
                          return;
                        }
                        setEditingRescheduleId(entry.id);
                        setFromLessonDate(entry.fromDate);
                        setToLessonDate(
                          isPendingRescheduleEntry(entry) ? "" : entry.toDate,
                        );
                        setLockFromLessonDate(true);
                        const wd = weekdayFromIsoDate(
                          isPendingRescheduleEntry(entry) ? entry.fromDate : entry.toDate,
                        );
                        const opts =
                          wd === "六"
                            ? SATURDAY_TIME_SUGGESTIONS
                            : WEEKDAY_TIME_SUGGESTIONS;
                        const timePreset =
                          opts.includes(entry.time) ? entry.time : opts[0];
                        setEditForm({
                          timePreset,
                          timeCustom: opts.includes(entry.time) ? "" : entry.time,
                          room: ROOM_OPTIONS.includes(entry.room)
                            ? entry.room
                            : ROOM_OPTIONS[0],
                          doubleEnabled: false,
                        });
                        setShowEditPanel(true);
                        return;
                      }
                      setEditingRescheduleId(null);
                      setFromLessonDate("");
                      setToLessonDate(toHkIsoDateFromMs(Date.now()));
                      setLockFromLessonDate(false);
                      setEditForm({
                        timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
                        timeCustom: "",
                        room: ROOM_OPTIONS[0],
                        doubleEnabled: false,
                      });
                      setShowEditPanel(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path d="M4.5 5.75a.75.75 0 010-1.5h9.69l-2.22-2.22a.75.75 0 111.06-1.06l3.5 3.5a.75.75 0 010 1.06l-3.5 3.5a.75.75 0 01-1.06-1.06l2.22-2.22H4.5zm11 8.5a.75.75 0 010 1.5H5.81l2.22 2.22a.75.75 0 11-1.06 1.06l-3.5-3.5a.75.75 0 010-1.06l3.5-3.5a.75.75 0 011.06 1.06l-2.22 2.22H15.5z" />
                    </svg>
                    Reschedule
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRowIds.length > 1) {
                        setSelectionError(
                          "For pending leave, select only 1 regular lesson row.",
                        );
                        return;
                      }
                      setShowExtraPanel(false);
                      setReschedulePanelMode("pending");
                      setSelectionError("");
                      setEditingRescheduleId(null);
                      if (selectedRowIds.length === 1) {
                        const row = scheduleRowById.get(selectedRowIds[0]);
                        if (!row || row.rowKind !== "normal") {
                          setSelectionError("Select a regular lesson row to mark leave / pending makeup.");
                          return;
                        }
                        setFromLessonDate(row.date);
                        setToLessonDate("");
                        setLockFromLessonDate(true);
                      } else {
                        setFromLessonDate("");
                        setToLessonDate("");
                        setLockFromLessonDate(false);
                      }
                      setShowEditPanel(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                  >
                    {PENDING_MAKEUP_BUTTON_LABEL}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionError("");
                      if (selectedRowIds.length > 1) {
                        setSelectionError("For extra lesson, select only 1 row for prefill, or clear selection and fill manually.");
                        return;
                      }
                      setShowEditPanel(false);
                      if (selectedRowIds.length === 1) {
                        const row = scheduleRowById.get(selectedRowIds[0]);
                        if (!row) {
                          setSelectionError("Cannot find row for prefill.");
                          return;
                        }
                        const wd = weekdayFromIsoDate(row.date);
                        const opts =
                          wd === "六" ? SATURDAY_TIME_SUGGESTIONS : WEEKDAY_TIME_SUGGESTIONS;
                        setExtraForm({
                          date: row.date,
                          timePreset: opts.includes(row.time) ? row.time : opts[0],
                          timeCustom: opts.includes(row.time) ? "" : row.time,
                          room: ROOM_OPTIONS.includes(row.room) ? row.room : ROOM_OPTIONS[0],
                          doubleEnabled: false,
                        });
                      } else {
                        setExtraForm({
                          date: toHkIsoDateFromMs(Date.now()),
                          timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
                          timeCustom: "",
                          room: ROOM_OPTIONS[0],
                          doubleEnabled: false,
                        });
                      }
                      setShowExtraPanel(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" />
                    </svg>
                    Extra Lesson
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRowIds.length === 0) {
                        setSelectionError("Please select rows to delete first.");
                        return;
                      }
                      setSelectionError("");
                      if (!window.confirm("Are you sure you want to delete selected dates?")) return;
                      const selectedRows = selectedRowIds
                        .map((id) => scheduleRowById.get(id))
                        .filter((r): r is ScheduleRow => Boolean(r));

                      const rescheduleIdsToDelete = new Set<string>();
                      const extraIdsToDelete = new Set<string>();
                      for (const row of selectedRows) {
                        if (row.rescheduleEntryId) {
                          rescheduleIdsToDelete.add(row.rescheduleEntryId);
                        }
                        if (row.extraEntryId) {
                          extraIdsToDelete.add(row.extraEntryId);
                        }
                      }

                      if (rescheduleIdsToDelete.size > 0) {
                        const nextEntries = rescheduleEntries.filter(
                          (e) => !rescheduleIdsToDelete.has(e.id),
                        );
                        setRescheduleEntries(nextEntries);
                        window.localStorage.setItem(
                          RESCHEDULE_STORAGE_KEY,
                          JSON.stringify(nextEntries),
                        );
                        persistYearState({ rescheduleEntries: nextEntries });
                      }

                      if (extraIdsToDelete.size > 0) {
                        const nextExtraEntries = extraEntries.filter(
                          (e) => !extraIdsToDelete.has(e.id),
                        );
                        setExtraEntries(nextExtraEntries);
                        window.localStorage.setItem(
                          EXTRA_STORAGE_KEY,
                          JSON.stringify(nextExtraEntries),
                        );
                        persistYearState({ extraEntries: nextExtraEntries });
                      }

                      const nextHidden = { ...hiddenDates };
                      for (const row of selectedRows) {
                        if (row.rowKind === "normal" && !row.extraEntryId) {
                          nextHidden[row.date] = true;
                        }
                      }
                      setHiddenDates(nextHidden);
                      window.localStorage.setItem(
                        HIDDEN_DATES_STORAGE_KEY,
                        JSON.stringify(nextHidden),
                      );
                      persistYearState({ hiddenDates: nextHidden });
                      setSelectedRowIds([]);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path d="M7.5 2.75A1.75 1.75 0 005.75 4.5v.25H4a.75.75 0 000 1.5h.5l.73 9.1A2 2 0 007.22 17.2h5.56a2 2 0 001.99-1.85l.73-9.1H16a.75.75 0 000-1.5h-1.75V4.5A1.75 1.75 0 0012.5 2.75h-5zM12.75 4.5v.25h-5.5V4.5a.25.25 0 01.25-.25h5a.25.25 0 01.25.25z" />
                    </svg>
                    Delete
                  </button>
                </div>
              </div>
              {selectionError && (
                <p className="mt-2 text-xs font-medium text-red-600">{selectionError}</p>
              )}
            </div>

            {showEditPanel && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-bold tracking-wider text-slate-600">
                    Original Lesson (from schedule settings)
                  </p>
                  {editOriginalLesson.kind === "empty" && (
                    <p className="mt-2 text-sm text-slate-600">
                      Select a <strong className="font-semibold text-slate-800">date</strong> below first.
                      This area shows the scheduled lesson (date, day, time, room) from lesson schedule settings.
                    </p>
                  )}
                  {editOriginalLesson.kind === "noRow" && (
                    <p className="mt-2 text-sm text-amber-800">
                      The selected date ({editOriginalLesson.date}) has no scheduled lesson in {targetYear}, so no original lesson can be compared.
                    </p>
                  )}
                  {editOriginalLesson.kind === "row" && (
                    <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Scheduled Date</dt>
                        <dd className="mt-0.5 font-medium text-slate-900">{editOriginalLesson.date}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Day</dt>
                        <dd className="mt-0.5 font-medium text-slate-900">
                          {WEEKDAY_LABEL[editOriginalLesson.weekday] ?? editOriginalLesson.weekday}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Scheduled Time</dt>
                        <dd className="mt-0.5 font-medium text-slate-900">{editOriginalLesson.baseTime}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Scheduled Room</dt>
                        <dd className="mt-0.5 font-medium text-slate-900">
                          {ROOM_LABEL[editOriginalLesson.baseRoom] ?? editOriginalLesson.baseRoom}
                        </dd>
                      </div>
                    </dl>
                  )}
                  {editOriginalLesson.kind === "row" && editOriginalLesson.hasOverride && (
                    <p className="mt-3 text-xs text-slate-600">
                      This date has already been rescheduled. Current timetable shows{" "}
                      <span className="font-semibold text-slate-800">
                        {editOriginalLesson.displayTime}
                      </span>
                      ／
                      <span className="font-semibold text-slate-800">
                        {ROOM_LABEL[editOriginalLesson.displayRoom] ?? editOriginalLesson.displayRoom}
                      </span>
                      . You can edit it again below.
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {reschedulePanelMode === "pending"
                      ? PENDING_MAKEUP_BUTTON_LABEL
                      : "Reschedule Settings"}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {reschedulePanelMode === "pending" ? (
                      <>
                        Enter only the{" "}
                        <strong className="font-semibold text-slate-800">original lesson date</strong>;
                        leave the new date empty. Home and the daily timetable show a countdown
                        (e.g. &quot;Make up within 3 days&quot;). Later use Reschedule with a new
                        date to complete the makeup lesson.
                      </>
                    ) : (
                      <>
                        Fill in{" "}
                        <strong className="font-semibold text-slate-800">Original Date</strong> and
                        <strong className="font-semibold text-slate-800"> New Date</strong>. The new
                        weekday is auto-filled. After saving, the original row becomes attendance
                        &quot;/&quot; with type &quot;Cancelled&quot;, and a &quot;Reschedule&quot;
                        row is inserted below it.
                      </>
                    )}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Original Date</span>
                    <input
                      type="date"
                      min={yearMin}
                      max={yearMax}
                      value={fromLessonDate}
                      disabled={lockFromLessonDate}
                      onChange={(e) => setFromLessonDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    />
                    {lockFromLessonDate ? (
                      <p className="mt-1 text-[11px] text-slate-500">Filled from selected row; original date is locked.</p>
                    ) : null}
                  </label>

                  {reschedulePanelMode === "reschedule" ? (
                    <label className="block">
                      <span className="mb-1 block text-sm font-semibold text-slate-700">New Date</span>
                      <input
                        type="date"
                        min={yearMin}
                        max={yearMax}
                        value={toLessonDate}
                        onChange={(e) => {
                          const v = e.target.value;
                          setToLessonDate(v);
                          if (v) {
                            applyEditDefaultsForDate(v);
                          }
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                      />
                    </label>
                  ) : null}

                  {reschedulePanelMode === "reschedule" ? (
                  <>
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Weekday (New)</span>
                    <input
                      type="text"
                      value={editWeekday ? WEEKDAY_LABEL[editWeekday] ?? editWeekday : "— (Choose new date first)"}
                      readOnly
                      disabled
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    />
                  </label>

                  <div className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Time (New)</span>
                    <select
                      value={editForm.timePreset}
                      disabled={!toLessonDate}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, timePreset: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      {editTimeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={editForm.timeCustom}
                        disabled={!toLessonDate}
                        onChange={(e) =>
                          setEditForm((p) => ({ ...p, timeCustom: e.target.value }))
                        }
                      placeholder="Custom input (optional)"
                        className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setShowEditPanel(false);
                          setEditSaveStatus("");
                          setEditingRescheduleId(null);
                          setFromLessonDate("");
                          setToLessonDate("");
                          setLockFromLessonDate(false);
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                          <path d="M5.22 5.22a.75.75 0 011.06 0L10 8.94l3.72-3.72a.75.75 0 111.06 1.06L11.06 10l3.72 3.72a.75.75 0 11-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 11-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 010-1.06z" />
                        </svg>
                        Cancel
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditSaveStatus("Button pressed...");
                        }}
                        onClick={() => {
                          try {
                            setEditSaveStatus("Saving...");
                            setSelectionError("Saving...");
                            if (!fromLessonDate.trim() || !toLessonDate.trim()) {
                              setEditSaveStatus("Please fill both original and new dates.");
                              setSelectionError("Please fill both original and new dates before saving.");
                              return;
                            }
                            const from = fromLessonDate.trim();
                            const to = toLessonDate.trim();
                            if (!baseRowByDate.has(from)) {
                              setEditSaveStatus("Original date is not a regular lesson date.");
                              setSelectionError("Original date must be an existing regular lesson date.");
                              return;
                            }
                            const ids = rescheduleIdsByFromDate.get(from) ?? [];
                            if (ids.some((id) => id !== editingRescheduleId)) {
                              setEditSaveStatus("This original date already has a reschedule record.");
                              setSelectionError("This original date already has a reschedule record.");
                              return;
                            }
                            const finalTime = editForm.timeCustom.trim()
                              ? editForm.timeCustom.trim()
                              : editForm.timePreset.trim();
                            if (!finalTime) {
                              setEditSaveStatus("Please select or enter a new lesson time.");
                              setSelectionError("Please select or enter a new lesson time.");
                              return;
                            }
                            const nextList = editingRescheduleId
                              ? rescheduleEntries.map((e) =>
                                  e.id === editingRescheduleId
                                    ? {
                                        ...e,
                                        fromDate: from,
                                        toDate: to,
                                        time: finalTime,
                                        room: editForm.room.trim(),
                                        pending: false,
                                      }
                                    : e,
                                )
                              : [
                                  ...rescheduleEntries,
                                  {
                                    id: `${Date.now()}`,
                                    fromDate: from,
                                    toDate: to,
                                    time: finalTime,
                                    room: editForm.room.trim(),
                                  },
                                ];
                            setRescheduleEntries(nextList);
                            window.localStorage.setItem(
                              RESCHEDULE_STORAGE_KEY,
                              JSON.stringify(nextList),
                            );
                            persistYearState({ rescheduleEntries: nextList });
                            if (!editingRescheduleId && editForm.doubleEnabled) {
                              const nextExtraEntries = [
                                ...extraEntries,
                                {
                                  id: `${Date.now()}-double-reschedule`,
                                  date: to,
                                  time: finalTime,
                                  room: editForm.room.trim(),
                                },
                              ];
                              setExtraEntries(nextExtraEntries);
                              window.localStorage.setItem(
                                EXTRA_STORAGE_KEY,
                                JSON.stringify(nextExtraEntries),
                              );
                              persistYearState({ extraEntries: nextExtraEntries });
                            }

                            const restOverrides = { ...overrides };
                            delete restOverrides[from];
                            setOverrides(restOverrides);
                            window.localStorage.setItem(
                              OVERRIDES_STORAGE_KEY,
                              JSON.stringify(restOverrides),
                            );
                            persistYearState({ overrides: restOverrides });

                            setSelectionError("Saved.");
                            setEditSaveStatus("Saved.");
                            window.setTimeout(() => {
                              setSelectionError((prev) => (prev === "Saved." ? "" : prev));
                              setEditSaveStatus((prev) => (prev === "Saved." ? "" : prev));
                              setShowEditPanel(false);
                              setEditingRescheduleId(null);
                              setFromLessonDate("");
                              setToLessonDate("");
                              setLockFromLessonDate(false);
                              setSelectedRowIds([]);
                            }, 1200);
                          } catch (error) {
                            const message =
                              error instanceof Error ? error.message : "Unexpected error while saving.";
                            setEditSaveStatus(`Error: ${message}`);
                            setSelectionError(`Save failed: ${message}`);
                          }
                        }}
                        className="relative z-10 pointer-events-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-[#1d76c2] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                      >
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                          <path d="M3 4.5A1.5 1.5 0 014.5 3h8.44c.4 0 .78.16 1.06.44l2.06 2.06c.28.28.44.66.44 1.06V15.5A1.5 1.5 0 0115 17H4.5A1.5 1.5 0 013 15.5v-11zM5 5v3h7V5H5zm0 6.5A.5.5 0 015.5 11h9a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-4z" />
                        </svg>
                        Save
                      </button>
                      {editSaveStatus ? (
                        <span className="shrink-0 text-xs font-semibold text-slate-600">{editSaveStatus}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Room (New)</span>
                    <div className="flex items-center gap-3">
                      <select
                        value={editForm.room}
                        disabled={!toLessonDate}
                        onChange={(e) => setEditForm((p) => ({ ...p, room: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        {ROOM_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {ROOM_LABEL[option] ?? option}
                          </option>
                        ))}
                      </select>
                      <label className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={editForm.doubleEnabled}
                          disabled={Boolean(editingRescheduleId)}
                          onChange={(e) =>
                            setEditForm((p) => ({ ...p, doubleEnabled: e.target.checked }))
                          }
                          className="h-5 w-5 accent-[#1d76c2] disabled:cursor-not-allowed"
                        />
                        Double Lesson
                      </label>
                    </div>
                  </div>
                  {editForm.doubleEnabled ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 lg:col-span-5">
                      Double Lesson enabled: the second lesson uses the same day, time, and room.
                    </div>
                  ) : null}
                  </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 lg:col-span-4">
                      <button
                        type="button"
                        onClick={() => {
                          setShowEditPanel(false);
                          setEditSaveStatus("");
                          setReschedulePanelMode("reschedule");
                          setFromLessonDate("");
                          setToLessonDate("");
                          setLockFromLessonDate(false);
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            setEditSaveStatus("Saving...");
                            setSelectionError("Saving...");
                            if (!fromLessonDate.trim()) {
                              setEditSaveStatus("Please fill the original lesson date.");
                              setSelectionError("Please fill the original lesson date.");
                              return;
                            }
                            const from = fromLessonDate.trim();
                            if (!baseRowByDate.has(from)) {
                              setEditSaveStatus("Original date is not a regular lesson date.");
                              setSelectionError("Original date must be an existing regular lesson date.");
                              return;
                            }
                            const ids = rescheduleIdsByFromDate.get(from) ?? [];
                            if (ids.length > 0) {
                              setEditSaveStatus("This original date already has a reschedule record.");
                              setSelectionError("This original date already has a reschedule record.");
                              return;
                            }
                            const nextList = [
                              ...rescheduleEntries,
                              {
                                id: `${Date.now()}`,
                                fromDate: from,
                                toDate: "",
                                time: "",
                                room: "",
                                pending: true,
                              },
                            ];
                            setRescheduleEntries(nextList);
                            window.localStorage.setItem(
                              RESCHEDULE_STORAGE_KEY,
                              JSON.stringify(nextList),
                            );
                            persistYearState({ rescheduleEntries: nextList });
                            setSelectionError("Saved.");
                            setEditSaveStatus("Saved.");
                            window.setTimeout(() => {
                              setSelectionError((prev) => (prev === "Saved." ? "" : prev));
                              setEditSaveStatus((prev) => (prev === "Saved." ? "" : prev));
                              setShowEditPanel(false);
                              setReschedulePanelMode("reschedule");
                              setFromLessonDate("");
                              setToLessonDate("");
                              setLockFromLessonDate(false);
                              setSelectedRowIds([]);
                            }, 1200);
                          } catch (error) {
                            const message =
                              error instanceof Error ? error.message : "Unexpected error while saving.";
                            setEditSaveStatus(`Error: ${message}`);
                            setSelectionError(`Save failed: ${message}`);
                          }
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                      >
                        Save
                      </button>
                      {editSaveStatus ? (
                        <span className="shrink-0 text-xs font-semibold text-slate-600">{editSaveStatus}</span>
                      ) : null}
                    </div>
                  )}
                </div>

              </div>
            )}

            {showExtraPanel && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div>
                  <p className="text-sm font-bold text-slate-900">Extra Lesson Settings</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Add an extra lesson record without overwriting existing schedule. Month and L labels recalculate automatically.
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Extra Lesson Date</span>
                    <input
                      type="date"
                      min={yearMin}
                      max={yearMax}
                      value={extraForm.date}
                      onChange={(e) => {
                        const v = e.target.value;
                        const wd = weekdayFromIsoDate(v);
                        const opts =
                          wd === "六" ? SATURDAY_TIME_SUGGESTIONS : WEEKDAY_TIME_SUGGESTIONS;
                        setExtraForm((p) => ({
                          ...p,
                          date: v,
                          timePreset: opts.includes(p.timePreset) ? p.timePreset : opts[0],
                        }));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Weekday</span>
                    <input
                      type="text"
                      value={extraForm.date ? WEEKDAY_LABEL[weekdayFromIsoDate(extraForm.date)] ?? weekdayFromIsoDate(extraForm.date) : "—"}
                      readOnly
                      disabled
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    />
                  </label>

                  <div className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Time</span>
                    <select
                      value={extraForm.timePreset}
                      onChange={(e) => setExtraForm((p) => ({ ...p, timePreset: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                    >
                      {(weekdayFromIsoDate(extraForm.date) === "六"
                        ? SATURDAY_TIME_SUGGESTIONS
                        : WEEKDAY_TIME_SUGGESTIONS
                      ).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={extraForm.timeCustom}
                        onChange={(e) => setExtraForm((p) => ({ ...p, timeCustom: e.target.value }))}
                      placeholder="Custom input (optional)"
                        className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setShowExtraPanel(false);
                          setExtraSaveStatus("");
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                          <path d="M5.22 5.22a.75.75 0 011.06 0L10 8.94l3.72-3.72a.75.75 0 111.06 1.06L11.06 10l3.72 3.72a.75.75 0 11-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 11-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 010-1.06z" />
                        </svg>
                        Cancel
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setExtraSaveStatus("Button pressed...");
                        }}
                        onClick={() => {
                          try {
                            setExtraSaveStatus("Saving...");
                            setSelectionError("Saving...");
                            const date = extraForm.date.trim();
                            if (!date) {
                              setExtraSaveStatus("Please fill extra lesson date.");
                              setSelectionError("Please fill extra lesson date first.");
                              return;
                            }
                            const finalTime = extraForm.timeCustom.trim()
                              ? extraForm.timeCustom.trim()
                              : extraForm.timePreset.trim();
                            if (!finalTime) {
                              setExtraSaveStatus("Please select or enter extra lesson time.");
                              setSelectionError("Please select or enter extra lesson time.");
                              return;
                            }
                            const nextExtra = [
                              ...extraEntries,
                              {
                                id: `${Date.now()}`,
                                date,
                                time: finalTime,
                                room: extraForm.room.trim(),
                              },
                            ];
                            if (extraForm.doubleEnabled) {
                              nextExtra.push({
                                id: `${Date.now()}-2`,
                                date,
                                time: finalTime,
                                room: extraForm.room.trim(),
                              });
                            }
                            setExtraEntries(nextExtra);
                            window.localStorage.setItem(
                              EXTRA_STORAGE_KEY,
                              JSON.stringify(nextExtra),
                            );
                            persistYearState({ extraEntries: nextExtra });
                            setSelectionError("Saved.");
                            setExtraSaveStatus("Saved.");
                            window.setTimeout(() => {
                              setSelectionError((prev) => (prev === "Saved." ? "" : prev));
                              setExtraSaveStatus((prev) => (prev === "Saved." ? "" : prev));
                              setShowExtraPanel(false);
                              setSelectedRowIds([]);
                            }, 1200);
                          } catch (error) {
                            const message =
                              error instanceof Error ? error.message : "Unexpected error while saving.";
                            setExtraSaveStatus(`Error: ${message}`);
                            setSelectionError(`Save failed: ${message}`);
                          }
                        }}
                        className="relative z-10 pointer-events-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-[#1d76c2] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                      >
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                          <path d="M3 4.5A1.5 1.5 0 014.5 3h8.44c.4 0 .78.16 1.06.44l2.06 2.06c.28.28.44.66.44 1.06V15.5A1.5 1.5 0 0115 17H4.5A1.5 1.5 0 013 15.5v-11zM5 5v3h7V5H5zm0 6.5A.5.5 0 015.5 11h9a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-4z" />
                        </svg>
                        Save
                      </button>
                      {extraSaveStatus ? (
                        <span className="shrink-0 text-xs font-semibold text-slate-600">{extraSaveStatus}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Room</span>
                    <div className="flex items-center gap-3">
                      <select
                        value={extraForm.room}
                        onChange={(e) => setExtraForm((p) => ({ ...p, room: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                      >
                        {ROOM_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {ROOM_LABEL[option] ?? option}
                          </option>
                        ))}
                      </select>
                      <label className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={extraForm.doubleEnabled}
                          onChange={(e) =>
                            setExtraForm((p) => ({ ...p, doubleEnabled: e.target.checked }))
                          }
                          className="h-5 w-5 accent-[#1d76c2]"
                        />
                        Double Lesson
                      </label>
                    </div>
                  </div>
                  {extraForm.doubleEnabled ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 lg:col-span-5">
                      Double Lesson enabled: the second lesson uses the same day, time, and room.
                    </div>
                  ) : null}
                </div>

              </div>
            )}

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="overflow-x-auto">
                <div className="flex min-w-[1500px] items-end gap-3">
                <label className="w-40 shrink-0">
                  <span className="mb-1 block text-xs font-semibold tracking-wider text-slate-600">Month</span>
                  <select
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  >
                    <option value="">All</option>
                    {monthFilterOptions.map((month) => (
                      <option key={month} value={String(month)}>
                        {MONTH_LABEL[month] ?? month}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="w-[340px] shrink-0">
                  <span className="mb-1 block text-xs font-semibold tracking-wider text-slate-600">Date Period</span>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <input
                      type="date"
                      value={filterDateFrom}
                      onChange={(e) => setFilterDateFrom(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                    />
                    <span className="text-xs text-slate-500">to</span>
                    <input
                      type="date"
                      value={filterDateTo}
                      onChange={(e) => setFilterDateTo(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                    />
                  </div>
                </div>

                <label className="w-44 shrink-0">
                  <span className="mb-1 block text-xs font-semibold tracking-wider text-slate-600">Time</span>
                  <input
                    type="text"
                    value={filterTime}
                    onChange={(e) => setFilterTime(e.target.value)}
                    placeholder="e.g. 03:00 PM"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  />
                </label>

                <label className="w-36 shrink-0">
                  <span className="mb-1 block text-xs font-semibold tracking-wider text-slate-600">Room</span>
                  <select
                    value={filterRoom}
                    onChange={(e) => setFilterRoom(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  >
                    <option value="">All</option>
                    {roomFilterOptions.map((room) => (
                      <option key={room} value={room}>
                        {ROOM_LABEL[room] ?? room}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="w-40 shrink-0">
                  <span className="mb-1 block text-xs font-semibold tracking-wider text-slate-600">Tutor</span>
                  <select
                    value={filterTutor}
                    onChange={(e) => setFilterTutor(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  >
                    <option value="">All</option>
                    {tutorFilterOptions.map((tutor) => (
                      <option key={tutor} value={tutor}>
                        {tutor}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="w-36 shrink-0">
                  <span className="mb-1 block text-xs font-semibold tracking-wider text-slate-600">Type</span>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  >
                    <option value="">All</option>
                    {typeFilterOptions.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex shrink-0 items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterMonth("");
                      setFilterDateFrom("");
                      setFilterDateTo("");
                      setFilterTime("");
                      setFilterRoom("");
                      setFilterTutor("");
                      setFilterType("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded bg-[#1d76c2] px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1663a3]"
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
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[1180px] divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr className="divide-x divide-slate-200">
                      <th className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-4 py-3 text-left text-xs font-bold tracking-wider text-slate-700">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRowIds(filteredScheduleRows.map((r) => r.rowId));
                            } else {
                              setSelectedRowIds([]);
                            }
                          }}
                          className="h-4 w-4 accent-[#1d76c2]"
                          aria-label="Select all"
                        />
                      </th>
                      <LessonSortableHeader
                        label="Month"
                        columnKey="month"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                        thClassName="whitespace-nowrap"
                      />
                      <LessonSortableHeader
                        label="L"
                        columnKey="lLabel"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                      />
                      <LessonSortableHeader
                        label="Attendance"
                        columnKey="attendance"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                        thClassName="w-20 whitespace-nowrap"
                      />
                      <LessonSortableHeader
                        label="Date"
                        columnKey="date"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                      />
                      <LessonSortableHeader
                        label="Day"
                        columnKey="weekday"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                        thClassName="w-20 whitespace-nowrap"
                      />
                      <LessonSortableHeader
                        label="Time"
                        columnKey="time"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                      />
                      <LessonSortableHeader
                        label="Room"
                        columnKey="room"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                        thClassName="w-20 whitespace-nowrap"
                      />
                      <LessonSortableHeader
                        label="Tutor"
                        columnKey="tutor"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                      />
                      <LessonSortableHeader
                        label="Lesson Summary"
                        columnKey="lessonSummary"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                        thClassName="w-[20%] min-w-[220px] whitespace-normal"
                      />
                      <LessonSortableHeader
                        label="Type"
                        columnKey="lessonType"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                        thClassName="w-24 whitespace-nowrap"
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {scheduleRows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-500">
                          No records in lesson schedule settings yet.
                        </td>
                      </tr>
                    ) : filteredScheduleRows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-500">
                          No records match current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredScheduleRows.map((r, idx) => (
                        <tr
                          key={r.rowId}
                          className={[
                            "divide-x divide-slate-100",
                            idx < filteredScheduleRows.length - 1 &&
                            filteredScheduleRows[idx + 1].month !== r.month
                              ? "border-b-2 border-slate-400"
                              : "",
                            r.lessonType === TYPE_PENDING
                              ? "bg-amber-50/80"
                              : r.rowKind === "cancelled_original"
                              ? "bg-slate-50"
                              : r.rowKind === "reschedule"
                                ? "bg-blue-50/50"
                                : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={selectedRowIdSet.has(r.rowId)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedRowIds((prev) => [...prev, r.rowId]);
                                } else {
                                  setSelectedRowIds((prev) =>
                                    prev.filter((id) => id !== r.rowId),
                                  );
                                }
                              }}
                              className="h-4 w-4 accent-[#1d76c2]"
                              aria-label={`${r.date} select row`}
                            />
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {MONTH_LABEL[r.month] ?? r.month}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                            {r.lLabel}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-sm text-slate-700">
                            {r.rowKind === "cancelled_original" ? (
                              <span className="font-semibold text-slate-500">/</span>
                            ) : (
                              <span
                                className="inline-block min-w-4 text-center font-semibold text-slate-700"
                                aria-label={`${r.date} attendance (read-only)`}
                                title="Attendance is read-only here. Please mark attendance in the Room page."
                              >
                                {r.rowKind === "normal" && r.attendanceKey.startsWith("regular:")
                                  ? isRegularLessonAttended(attendance, { id: r.attendanceKey.slice("regular:".length) }, r.date)
                                    ? "✓"
                                    : ""
                                  : attendance[r.attendanceKey]
                                    ? "✓"
                                    : ""}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {r.lessonType === TYPE_RESCHEDULE && r.rescheduleFromDate
                              ? `${r.rescheduleFromDate} → ${r.date}`
                              : r.date}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-sm text-slate-700">
                            {r.lessonType === TYPE_RESCHEDULE && r.rescheduleFromDate
                              ? `${WEEKDAY_LABEL[weekdayFromIsoDate(r.rescheduleFromDate)] ?? weekdayFromIsoDate(r.rescheduleFromDate)} → ${WEEKDAY_LABEL[r.weekday] ?? r.weekday}`
                              : (WEEKDAY_LABEL[r.weekday] ?? r.weekday)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {r.lessonType === TYPE_RESCHEDULE && r.rescheduleFromDate
                              ? `${r.baseTime} → ${r.time}`
                              : r.time}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-sm text-slate-700">
                            {r.lessonType === TYPE_RESCHEDULE && r.rescheduleFromDate
                              ? `${ROOM_LABEL[r.baseRoom] ?? r.baseRoom} → ${ROOM_LABEL[r.room] ?? r.room}`
                              : (ROOM_LABEL[r.room] ?? r.room)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {displayTutorInCell(r.tutor)}
                          </td>
                          <td className="w-[20%] min-w-[220px] px-4 py-3 text-sm text-slate-700 align-top break-words whitespace-normal">
                            <textarea
                              rows={3}
                              disabled
                              suppressHydrationWarning
                              value={
                                lessonSummaryDraftByDateIso[r.date] ?? r.lessonSummary ?? ""
                              }
                              aria-label={`${r.date} Lesson Summary`}
                              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
                            />
                          </td>
                          <td className="w-24 whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            <div className="space-y-1">
                              <span
                                className={[
                                  "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                                  r.lessonType === TYPE_REGULAR
                                    ? "bg-slate-100 text-slate-700"
                                    : r.lessonType === TYPE_PENDING
                                      ? "bg-amber-100 text-amber-900"
                                    : r.lessonType === TYPE_RESCHEDULE
                                      ? "bg-blue-100 text-blue-700"
                                      : r.lessonType === TYPE_EXTRA
                                        ? "bg-emerald-100 text-emerald-700"
                                        : r.lessonType === TYPE_CANCELLED
                                          ? "bg-rose-100 text-rose-700"
                                          : "bg-slate-100 text-slate-700",
                                ].join(" ")}
                              >
                                {r.lessonType}
                              </span>
                              {r.pendingMakeupLabel ? (
                                <p className="text-[11px] font-semibold text-amber-800">
                                  {r.pendingMakeupLabel}
                                </p>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StudentLessons2026Page() {
  return <StudentLessonsYearPage targetYear={2026} />;
}

const LESSON_TH_BASE =
  "sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-3 text-left text-xs font-bold tracking-wider text-slate-700";

type LessonSortableHeaderProps = {
  label: string;
  columnKey: ScheduleSortKey;
  sortConfig: ScheduleSortConfig;
  setSortConfig: (config: ScheduleSortConfig) => void;
  /** 額外 th class，例如寬度；預設為 whitespace-nowrap */
  thClassName?: string;
};

function LessonSortableHeader({
  label,
  columnKey,
  sortConfig,
  setSortConfig,
  thClassName,
}: LessonSortableHeaderProps) {
  const selectedDirection =
    sortConfig?.key === columnKey ? sortConfig.direction : "";

  return (
    <th
      className={`${LESSON_TH_BASE} ${thClassName ?? "whitespace-nowrap"}`}
    >
      <div className="flex items-center gap-1.5">
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
          className="h-6 min-w-10 shrink-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-700"
        >
          <option value="">▽</option>
          <option value="asc">↑</option>
          <option value="desc">↓</option>
        </select>
      </div>
    </th>
  );
}
