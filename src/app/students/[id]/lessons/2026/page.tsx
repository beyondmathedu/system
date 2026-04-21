"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { loadLessonYearState, saveLessonYearState } from "@/lib/studentLessonStorage";
import { readYmdParts } from "@/lib/intlFormatParts";
import { loadInactiveTutorNames } from "@/lib/tutorVisibility";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { isLegacyBmStudentId, normalizeStudentId } from "@/lib/studentId";
import { formatGradeDisplay } from "@/lib/grade";

const PRIMARY_GRADIENT = "linear-gradient(to right, #1d76c2 0%, #1d76c2 100%)";
const ROOM_OPTIONS = ["B", "M前", "M後", "Hope", "Hope 2"];
const WEEKDAY_TIME_SUGGESTIONS = ["03:00 PM", "04:30 PM", "06:00 PM"];
const SATURDAY_TIME_SUGGESTIONS = ["10:00 AM", "11:30 AM", "01:00 PM", "02:30 PM"];
const TYPE_REGULAR = "恆常";
const TYPE_CANCELLED = "取消";
const TYPE_RESCHEDULE = "調堂";
const TYPE_EXTRA = "加堂";

type StudentSummary = {
  id: string;
  nameZh: string;
  nameEn: string;
  nicknameEn: string;
  grade: string;
  school: string;
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
};

type RescheduleEntry = {
  id: string;
  fromDate: string;
  toDate: string;
  time: string;
  room: string;
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
      const { data: auth } = await supabaseBrowser.auth.getUser();
      const user = auth.user;
      if (!user) {
        window.location.href = `/login?next=${encodeURIComponent(nextPath)}`;
        return;
      }
      const { data: profile } = await supabaseBrowser
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
  const [showExtraPanel, setShowExtraPanel] = useState(false);
  const [extraForm, setExtraForm] = useState<{
    date: string;
    timePreset: string;
    timeCustom: string;
    room: string;
  }>({
    date: "",
    timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
    timeCustom: "",
    room: ROOM_OPTIONS[0],
  });
  const [editForm, setEditForm] = useState<{
    timePreset: string;
    timeCustom: string;
    room: string;
  }>({ timePreset: "", timeCustom: "", room: "" });
  const [selectionError, setSelectionError] = useState("");
  const [sortConfig, setSortConfig] = useState<ScheduleSortConfig>(null);
  const [inactiveTutorNames, setInactiveTutorNames] = useState<Set<string>>(new Set());
  const yearMin = `${targetYear}-01-01`;
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
        const { data } = await supabaseBrowser
          .from("students")
          .select("id, name_zh, name_en, nickname_en, grade, school")
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
        });
        setStudentLoaded(true);
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

    const start = new Date(targetYear, 0, 1);
    const end = new Date(targetYear, 11, 31);

    const monthCounter: Record<number, number> = {};
    const rows: ScheduleRow[] = [];

    let activeIdx = -1;

    for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      const hkNum = getHkWeekdayNumber(cur);
      const weekday = numberToWeekday(hkNum);
      const dateIso = toIsoDate(cur);

      while (activeIdx + 1 < sortedRules.length && sortedRules[activeIdx + 1].effectiveDate <= dateIso) {
        activeIdx += 1;
      }
      const rule = activeIdx >= 0 ? sortedRules[activeIdx] : sortedRules[0];
      if (!rule) continue;
      if (weekday !== rule.weekday) continue;

      const rec = rule;
      const month = cur.getMonth() + 1;
      monthCounter[month] = (monthCounter[month] ?? 0) + 1;
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
        rowId: `${dateIso}-gen`,
        attendanceKey: dateIso,
        displayOrder: 0,
      });
    }

    return rows.filter((r) => !hiddenDates[r.date]);
  }, [records, studentId, overrides, hiddenDates, targetYear]);

  const baseRowByDate = useMemo(() => {
    const map = new Map<string, ScheduleRow>();
    for (const r of baseScheduleRows) map.set(r.date, r);
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

  const scheduleRows = useMemo(() => {
    if (!studentId) return [];

    let rows: ScheduleRow[] = [];
    for (const r of baseScheduleRows) {
      const e = rescheduleEntryByFromDate.get(r.date);
      if (!e) {
        rows.push({ ...r });
        continue;
      }

      const cancelled: ScheduleRow = {
        ...r,
        time: r.baseTime,
        room: r.baseRoom,
        lessonType: TYPE_CANCELLED,
        rowKind: "cancelled_original",
        rowId: `cancelled-${e.id}-${e.fromDate}`,
        attendanceKey: `cancelled:${e.fromDate}:${e.id}`,
        displayOrder: 0,
        rescheduleEntryId: e.id,
      };

      const toWd = weekdayFromIsoDate(e.toDate);
      const toParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.toDate);
      const toMonth = toParts ? Number(toParts[2]) : 1;

      const rescheduleRow: ScheduleRow = {
        month: toMonth,
        lLabel: TYPE_RESCHEDULE,
        date: e.toDate,
        weekday: toWd,
        baseTime: e.time,
        baseRoom: e.room,
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

      rows.push(cancelled, rescheduleRow);
    }

    for (const e of extraEntries) {
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

    rows.sort((a, b) => {
      const dc = a.date.localeCompare(b.date);
      if (dc !== 0) return dc;
      const tc = a.time.localeCompare(b.time, "en", { numeric: true });
      if (tc !== 0) return tc;
      return a.rowId.localeCompare(b.rowId);
    });

    const monthCounter: Record<number, number> = {};
    rows = rows.map((r, i) => {
      if (r.rowKind === "reschedule") {
        return { ...r, lLabel: TYPE_RESCHEDULE, displayOrder: i };
      }
      monthCounter[r.month] = (monthCounter[r.month] ?? 0) + 1;
      return { ...r, lLabel: `L${monthCounter[r.month]}`, displayOrder: i };
    });
    return rows;
  }, [baseScheduleRows, studentId, rescheduleEntryByFromDate, extraEntries]);

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

  const allVisibleSelected =
    scheduleRows.length > 0 &&
    scheduleRows.every((r) => selectedRowIdSet.has(r.rowId));

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
      return { timePreset, timeCustom: "", room };
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
            正在驗證帳號權限...
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
                aria-label="返回學生課堂頁"
              >
                ←
              </Link>
              <h1 className="text-2xl font-bold tracking-tight">學生獨立課堂記錄</h1>
            </div>

            <p className="mt-1 text-sm text-blue-100">
              學號：{studentId || "—"} | 學生：{" "}
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
              找不到學號 {studentId} 的學生資料。你仍可先操作 {targetYear} 課堂記錄，但建議先到 Students 頁新增該學生。
            </div>
          )}

          <div className="border-b border-slate-200 bg-slate-50 p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs font-semibold tracking-wider text-slate-500">學號</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{studentId || "—"}</p>
              </div>
              <div className="md:col-span-2">
                <p className="text-xs font-semibold tracking-wider text-slate-500">學生姓名</p>
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
                <p className="text-xs font-semibold tracking-wider text-slate-500">就讀年級</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{formatGradeDisplay(studentSummary.grade) || "—"}</p>
              </div>
              <div className="md:col-span-2">
                <p className="text-xs font-semibold tracking-wider text-slate-500">就讀學校</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.school || "—"}</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <h2 className="text-lg font-bold text-slate-900">{targetYear}上課記錄</h2>

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-700">
                  已選取：<span className="font-bold text-slate-900">{selectedRowIds.length}</span> 項
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRowIds.length > 1) {
                        setSelectionError("調堂請只勾選 1 行作為預填，或取消勾選後再按調堂自行填寫原課日期。");
                        return;
                      }
                      setShowExtraPanel(false);
                      setSelectionError("");
                      if (selectedRowIds.length === 1) {
                        const row = scheduleRowById.get(selectedRowIds[0]);
                        if (!row) {
                          setSelectionError("找不到要編輯的列。");
                          return;
                        }
                        if (row.rowKind === "normal") {
                          setEditingRescheduleId(null);
                          setFromLessonDate(row.date);
                          setToLessonDate(row.date);
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
                          });
                          setShowEditPanel(true);
                          return;
                        }

                        if (!row.rescheduleEntryId) {
                          setSelectionError("此列沒有可編輯的調堂紀錄。");
                          return;
                        }
                        const entry = rescheduleEntryById.get(row.rescheduleEntryId);
                        if (!entry) {
                          setSelectionError("找不到對應的調堂紀錄。");
                          return;
                        }
                        setEditingRescheduleId(entry.id);
                        setFromLessonDate(entry.fromDate);
                        setToLessonDate(entry.toDate);
                        const wd = weekdayFromIsoDate(entry.toDate);
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
                        });
                        setShowEditPanel(true);
                        return;
                      }
                      setEditingRescheduleId(null);
                      setFromLessonDate("");
                      setToLessonDate(toHkIsoDateFromMs(Date.now()));
                      setEditForm({
                        timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
                        timeCustom: "",
                        room: ROOM_OPTIONS[0],
                      });
                      setShowEditPanel(true);
                    }}
                    className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    調堂
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionError("");
                      if (selectedRowIds.length > 1) {
                        setSelectionError("加堂請只勾選 1 行作為預填，或取消勾選後自行填寫。");
                        return;
                      }
                      setShowEditPanel(false);
                      if (selectedRowIds.length === 1) {
                        const row = scheduleRowById.get(selectedRowIds[0]);
                        if (!row) {
                          setSelectionError("找不到要預填的列。");
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
                        });
                      } else {
                        setExtraForm({
                          date: toHkIsoDateFromMs(Date.now()),
                          timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
                          timeCustom: "",
                          room: ROOM_OPTIONS[0],
                        });
                      }
                      setShowExtraPanel(true);
                    }}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    加堂
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRowIds.length === 0) {
                        setSelectionError("請先勾選要刪除的列。");
                        return;
                      }
                      setSelectionError("");
                      if (!window.confirm("確定要刪除已選取的日期？")) return;
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
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    刪除
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
                    原課堂（時段設定，對照用）
                  </p>
                  {editOriginalLesson.kind === "empty" && (
                    <p className="mt-2 text-sm text-slate-600">
                      請先於下方選擇<strong className="font-semibold text-slate-800">日期</strong>
                      ，此處會顯示該日依「上課時段設定」的<strong className="font-semibold text-slate-800">
                        原定
                      </strong>
                      日子、星期、時間與房間。
                    </p>
                  )}
                  {editOriginalLesson.kind === "noRow" && (
                    <p className="mt-2 text-sm text-amber-800">
                      所選日期（{editOriginalLesson.date}）在 {targetYear} 課表中沒有排課，無原定課堂可對照。
                    </p>
                  )}
                  {editOriginalLesson.kind === "row" && (
                    <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">原定日期</dt>
                        <dd className="mt-0.5 font-medium text-slate-900">{editOriginalLesson.date}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">星期</dt>
                        <dd className="mt-0.5 font-medium text-slate-900">
                          星期{editOriginalLesson.weekday}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">原定時間</dt>
                        <dd className="mt-0.5 font-medium text-slate-900">{editOriginalLesson.baseTime}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">原定 Room</dt>
                        <dd className="mt-0.5 font-medium text-slate-900">{editOriginalLesson.baseRoom}</dd>
                      </div>
                    </dl>
                  )}
                  {editOriginalLesson.kind === "row" && editOriginalLesson.hasOverride && (
                    <p className="mt-3 text-xs text-slate-600">
                      此日已曾調堂；課表目前顯示為{" "}
                      <span className="font-semibold text-slate-800">
                        {editOriginalLesson.displayTime}
                      </span>
                      ／
                      <span className="font-semibold text-slate-800">
                        {editOriginalLesson.displayRoom}
                      </span>
                      。下方可再修改。
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">調堂設定</p>
                    <p className="mt-1 text-xs text-slate-600">
                      填寫<strong className="font-semibold text-slate-800">原課日期</strong>與
                      <strong className="font-semibold text-slate-800">新課日期</strong>
                      ；新課的星期會自動帶出。儲存後原課堂列會變為出席「/」、類型「取消」，其下會多一列「調堂」。
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditPanel(false);
                        setEditingRescheduleId(null);
                        setFromLessonDate("");
                        setToLessonDate("");
                      }}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!fromLessonDate.trim() || !toLessonDate.trim()) {
                          setSelectionError("請填寫原課日期與新課日期後再儲存。");
                          return;
                        }
                        const from = fromLessonDate.trim();
                        const to = toLessonDate.trim();
                        if (!baseRowByDate.has(from)) {
                          setSelectionError("原課日期必須是課表上已有的一般排課日。");
                          return;
                        }
                        const ids = rescheduleIdsByFromDate.get(from) ?? [];
                        if (ids.some((id) => id !== editingRescheduleId)) {
                          setSelectionError("此原課日期已有一次調堂紀錄，請勿重複。");
                          return;
                        }
                        const finalTime = editForm.timeCustom.trim()
                          ? editForm.timeCustom.trim()
                          : editForm.timePreset.trim();
                        if (!finalTime) {
                          setSelectionError("請選擇或輸入新課時間。");
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

                        const restOverrides = { ...overrides };
                        delete restOverrides[from];
                        setOverrides(restOverrides);
                        window.localStorage.setItem(
                          OVERRIDES_STORAGE_KEY,
                          JSON.stringify(restOverrides),
                        );
                        persistYearState({ overrides: restOverrides });

                        setSelectionError("");
                        setShowEditPanel(false);
                        setEditingRescheduleId(null);
                        setFromLessonDate("");
                        setToLessonDate("");
                        setSelectedRowIds([]);
                      }}
                      className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                    >
                      儲存
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">原課日期</span>
                    <input
                      type="date"
                      min={yearMin}
                      max={yearMax}
                      value={fromLessonDate}
                      onChange={(e) => setFromLessonDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">新課日期</span>
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

                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">星期（新課）</span>
                    <input
                      type="text"
                      value={editWeekday ? `星期${editWeekday}` : "—（請先選新課日期）"}
                      readOnly
                      disabled
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">時間（新課）</span>
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
                    <input
                      type="text"
                      value={editForm.timeCustom}
                      disabled={!toLessonDate}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, timeCustom: e.target.value }))
                      }
                      placeholder="自由輸入（可留空）"
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-100"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Room（新課）</span>
                    <select
                      value={editForm.room}
                      disabled={!toLessonDate}
                      onChange={(e) => setEditForm((p) => ({ ...p, room: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      {ROOM_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}

            {showExtraPanel && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">加堂設定</p>
                    <p className="mt-1 text-xs text-slate-600">
                      新增一筆「加堂」記錄，不會覆蓋原有排課；月份與 L 會自動重新計算。
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowExtraPanel(false)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const date = extraForm.date.trim();
                        if (!date) {
                          setSelectionError("請先填寫加堂日期。");
                          return;
                        }
                        const finalTime = extraForm.timeCustom.trim()
                          ? extraForm.timeCustom.trim()
                          : extraForm.timePreset.trim();
                        if (!finalTime) {
                          setSelectionError("請選擇或輸入加堂時間。");
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
                        setExtraEntries(nextExtra);
                        window.localStorage.setItem(
                          EXTRA_STORAGE_KEY,
                          JSON.stringify(nextExtra),
                        );
                        persistYearState({ extraEntries: nextExtra });
                        setSelectionError("");
                        setShowExtraPanel(false);
                        setSelectedRowIds([]);
                      }}
                      className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                    >
                      儲存
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">加堂日期</span>
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
                    <span className="mb-1 block text-sm font-semibold text-slate-700">星期</span>
                    <input
                      type="text"
                      value={extraForm.date ? `星期${weekdayFromIsoDate(extraForm.date)}` : "—"}
                      readOnly
                      disabled
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">時間</span>
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
                    <input
                      type="text"
                      value={extraForm.timeCustom}
                      onChange={(e) => setExtraForm((p) => ({ ...p, timeCustom: e.target.value }))}
                      placeholder="自由輸入（可留空）"
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Room</span>
                    <select
                      value={extraForm.room}
                      onChange={(e) => setExtraForm((p) => ({ ...p, room: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                    >
                      {ROOM_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px] divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr className="divide-x divide-slate-200">
                      <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold tracking-wider text-slate-700">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRowIds(scheduleRows.map((r) => r.rowId));
                            } else {
                              setSelectedRowIds([]);
                            }
                          }}
                          className="h-4 w-4 accent-[#1d76c2]"
                          aria-label="全選"
                        />
                      </th>
                      <LessonSortableHeader
                        label="月份"
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
                        label="出席"
                        columnKey="attendance"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                      />
                      <LessonSortableHeader
                        label="日期"
                        columnKey="date"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                      />
                      <LessonSortableHeader
                        label="星期"
                        columnKey="weekday"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                      />
                      <LessonSortableHeader
                        label="時間"
                        columnKey="time"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
                      />
                      <LessonSortableHeader
                        label="Room"
                        columnKey="room"
                        sortConfig={sortConfig}
                        setSortConfig={setSortConfig}
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
                        label="類型"
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
                          尚未在「上課時段設定」加入任何星期/時間/Room 記錄。
                        </td>
                      </tr>
                    ) : (
                      sortedScheduleRows.map((r, idx) => (
                        <tr
                          key={r.rowId}
                          className={[
                            "divide-x divide-slate-100",
                            idx > 0 && sortedScheduleRows[idx - 1].month !== r.month
                              ? "border-t-2 border-slate-300"
                              : "",
                            r.rowKind === "cancelled_original"
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
                              aria-label={`${r.date} 勾選`}
                            />
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {r.month}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                            {r.lLabel}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {r.rowKind === "cancelled_original" ? (
                              <span className="font-semibold text-slate-500">/</span>
                            ) : (
                              <span
                                className="inline-block min-w-4 text-center font-semibold text-slate-700"
                                aria-label={`${r.date} 出席（唯讀）`}
                                title="出席為唯讀，請到 Room 頁面勾選"
                              >
                                {attendance[r.attendanceKey] ? "✓" : ""}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {r.date}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            星期{r.weekday}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {r.time}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {r.room}
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
                            <span
                              className={[
                                "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                                r.lessonType === TYPE_REGULAR
                                  ? "bg-slate-100 text-slate-700"
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
  "px-3 py-3 text-left text-xs font-bold tracking-wider text-slate-700";

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
