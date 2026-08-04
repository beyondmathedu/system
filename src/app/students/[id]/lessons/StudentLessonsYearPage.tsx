"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import ScheduleDuplicateRulesBanner from "@/components/ScheduleDuplicateRulesBanner";
import { supabase } from "@/lib/supabase";
import { queueSaveLessonYearState, retrySaveLessonYearState, flushSaveLessonYearStateQueue, hasPendingLessonYearStateSaves } from "@/lib/queueSaveLessonYearState";
import { queueSaveLessonScheduleRecords, retrySaveLessonScheduleRecords } from "@/lib/queueSaveLessonScheduleRecords";
import {
  deleteTimetableDayRemark,
  loadTimetableDayRemarksForStudent,
  upsertTimetableDayRemark,
} from "@/lib/studentLessonStorage";
import { dayTimetableTableStrings } from "@/lib/dayTimetableUiStrings";
import { subscribeLessonSaveStatus } from "@/lib/lessonSaveStatus";
import { readYmdParts } from "@/lib/intlFormatParts";
import { loadInactiveTutorNames } from "@/lib/tutorVisibility";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { isLegacyBmStudentId, normalizeStudentId } from "@/lib/studentId";
import { formatGradeDisplay } from "@/lib/grade";
import { makeStudentInactiveDateCheckerFromPeriods, getInactiveMonthGapsInYearFromPeriods, type InactiveMonthGap } from "@/lib/studentVisibility";
import {
  defaultLessonYear,
  hkYmdNow,
  studentLessonsYearPath,
} from "@/lib/lessonCalendar";
import { lessonYearStateFieldsFromPatch } from "@/lib/lessonYearStateShared";
import {
  getLessonSystemStartIso,
  LESSON_SYSTEM_START_LABEL_ZH,
  LESSON_SYSTEM_START_MONTH,
  LESSON_SYSTEM_START_YEAR,
} from "@/lib/lessonSystemStart";
import {
  formatHiddenScheduleKeyLabel,
  hiddenScheduleRuleDateStorageKey,
  listHiddenScheduleKeys,
  parseRegularLessonRowId,
} from "@/lib/lessonScheduleHidden";
import {
  getActiveScheduleVersionDate,
  isRegularLessonAttended,
} from "@/lib/lessonScheduleVersions";
import {
  isPendingMakeupEditable,
  isPendingRescheduleEntry,
  PENDING_MAKEUP_BUTTON_LABEL,
  PENDING_MAKEUP_TYPE_LABEL,
  pendingMakeupLockedMessage,
} from "@/lib/pendingMakeup";
import {
  buildStudentBaseScheduleRows,
  buildStudentScheduleRows,
  type StudentScheduleBuildOptions,
  type StudentLessonScheduleRow,
} from "@/lib/studentScheduleRowMapper";
import type { RoomSlotTutorRule } from "@/lib/roomSlotTutorRules";
import { TUTOR_SHARED_IPAD_EMAIL } from "@/lib/tutorConstants";
import { useStudentLessonYearStateRealtime } from "@/lib/useStudentLessonYearStateRealtime";
import type { StudentLesson2026State } from "@/lib/studentLessonStorage";
import {
  ROOM_GROUPS,
  resolveScheduleRoomPickerValue,
  scheduleRoomsMatch,
  type RoomGroup,
} from "@/lib/dayTimetableShared";
import type { RoomDisplayRegistry } from "@/lib/roomDisplayRegistry";
import { useRoomDisplayLabels } from "@/lib/useRoomDisplayRegistry";
import {
  isUpcomingExamDate,
  visibleExamContent,
  visibleExamDateIso,
} from "@/lib/examDateVisibility";

const PRIMARY_GRADIENT = "linear-gradient(to right, #1d76c2 0%, #1d76c2 100%)";
const ROOM_OPTIONS = [...ROOM_GROUPS];
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

/** Extra / reschedule rows stay visible even during inactive periods (intentional admin actions). */
function keepScheduleRowVisibleDuringInactive(row: ScheduleRow): boolean {
  return (
    row.lessonType === TYPE_EXTRA ||
    row.lessonType === TYPE_RESCHEDULE ||
    row.rowKind === "reschedule" ||
    row.rowKind === "cancelled_original"
  );
}
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

function formatInactiveGapMonthRange(months: number[]): string {
  if (months.length === 0) return "";
  if (months.length === 1) return MONTH_LABEL[months[0]!] ?? String(months[0]);
  return `${MONTH_LABEL[months[0]!] ?? months[0]} – ${MONTH_LABEL[months[months.length - 1]!] ?? months[months.length - 1]}`;
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

type ScheduleRow = StudentLessonScheduleRow;

type LessonTableEntry =
  | { kind: "row"; row: ScheduleRow }
  | { kind: "inactive-gap"; gap: InactiveMonthGap; key: string };

type StudentInactivePeriodRow = {
  student_id: string;
  start_date: string;
  end_date: string | null;
  note: string;
};

type RescheduleEntry = {
  id: string;
  fromDate: string;
  toDate: string;
  time: string;
  room: string;
  pending?: boolean;
  fromScheduleRuleId?: string;
  fromTime?: string;
  fromRoom?: string;
};

type ExtraEntry = {
  id: string;
  date: string;
  time: string;
  room: string;
};

function fromSlotFieldsFromRow(row: {
  scheduleRuleId?: string;
  baseTime?: string;
  time?: string;
  baseRoom?: string;
  room?: string;
}): Pick<RescheduleEntry, "fromScheduleRuleId" | "fromTime" | "fromRoom"> {
  const fromScheduleRuleId = String(row.scheduleRuleId ?? "").trim();
  const fromTime = String(row.baseTime || row.time || "").trim();
  const fromRoom = String(row.baseRoom || row.room || "").trim();
  return {
    ...(fromScheduleRuleId ? { fromScheduleRuleId } : {}),
    ...(fromTime ? { fromTime } : {}),
    ...(fromRoom ? { fromRoom } : {}),
  };
}

function originalLessonSlotKey(row: {
  scheduleRuleId?: string;
  baseTime?: string;
  time?: string;
  baseRoom?: string;
  room?: string;
  fromScheduleRuleId?: string;
  fromTime?: string;
  fromRoom?: string;
}): string {
  const ruleId = String(row.fromScheduleRuleId ?? row.scheduleRuleId ?? "").trim();
  if (ruleId) return `rule:${ruleId}`;
  const time = String(row.fromTime ?? row.baseTime ?? row.time ?? "").trim();
  const room = String(row.fromRoom ?? row.baseRoom ?? row.room ?? "").trim();
  return `slot:${time}|${room}`;
}

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
  | "remarks"
  | "lessonType";
type ScheduleSortConfig = { key: ScheduleSortKey; direction: SortDirection } | null;

type BulkEditMode = "single" | "each";

type BulkEditLessonDraft = {
  rowId: string;
  date: string;
  timePreset: string;
  timeCustom: string;
  room: string;
  original: BulkEditOriginalSnapshot;
};

type BulkEditOriginalSnapshot = {
  date?: string;
  weekday: string;
  displayTime: string;
  displayRoom: string;
  baseTime: string;
  baseRoom: string;
};

type BulkEditFormState = {
  date: string;
  newWeekday: string;
  timePreset: string;
  timeCustom: string;
  room: string;
  effectiveDate: string;
  sourceRuleId: string;
  selectedDateIsos: string[];
  sourceSlotLabel: string;
  original: BulkEditOriginalSnapshot;
};

type RowEditKind = "regular" | "extra" | "reschedule";

type RowEditSession = {
  kind: RowEditKind;
  rowId: string;
  entryId?: string;
  /** Regular: original schedule date used as reschedule fromDate. */
  originalFromDate?: string;
  draft: BulkEditLessonDraft;
};

type RowEditConfirmPayload = {
  kind: RowEditKind;
  entryId?: string;
  originalFromDate?: string;
  scheduleRuleId?: string;
  baseTime?: string;
  baseRoom?: string;
  newDate: string;
  finalTime: string;
  finalRoom: string;
  before: { date: string; weekday: string; time: string; room: string };
  after: { date: string; weekday: string; time: string; room: string };
};

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

function weekdayFromIsoDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mm - 1, d);
  const js = dt.getDay();
  const hkNum = js === 0 ? 7 : js;
  const weekdays = ["", "一", "二", "三", "四", "五", "六", "日"] as const;
  return weekdays[hkNum] ?? "";
}

function resolveBulkEditTime(form: Pick<BulkEditFormState, "timePreset" | "timeCustom">): string {
  return form.timeCustom.trim() || form.timePreset.trim();
}

const BULK_EDIT_MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatLessonDateLabel(iso: string, weekday: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso || "—";
  const wd = WEEKDAY_LABEL[weekday] ?? weekday;
  const month = BULK_EDIT_MONTH_SHORT[Number(m[2]) - 1] ?? m[2];
  return `${wd}, ${Number(m[3])} ${month} ${m[1]}`;
}

/** Reschedule 列：只有欄位真係變咗先顯示舊→新，否則只顯示現值。 */
function RescheduleChangeCell({
  before,
  after,
  format = (v: string) => v,
}: {
  before: string;
  after: string;
  format?: (v: string) => string;
}) {
  const b = format((before ?? "").trim());
  const a = format((after ?? "").trim());
  const display = a || b || "—";
  if (!b || b === a) {
    return <span>{display}</span>;
  }
  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 line-through decoration-slate-400">
        {b}
      </span>
      <span className="text-slate-400" aria-hidden>
        →
      </span>
      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-xs font-semibold text-[#1d76c2]">
        {a || "—"}
      </span>
    </span>
  );
}

function BulkEditCompareRow({
  label,
  before,
  beforeHint,
  changed,
  children,
}: {
  label: string;
  before: string;
  beforeHint?: string;
  changed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 px-4 py-3.5 sm:grid-cols-[6.75rem_minmax(0,1fr)_auto_minmax(0,1.35fr)] sm:items-center sm:gap-3">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <div className="min-w-0">
        <span className="inline-flex max-w-full items-center rounded-md bg-slate-100 px-2.5 py-1.5 text-sm font-medium text-slate-600">
          <span className="truncate">{before || "—"}</span>
        </span>
        {beforeHint ? (
          <p className="mt-1 text-[11px] leading-snug text-slate-500">{beforeHint}</p>
        ) : null}
      </div>
      <span
        className="hidden shrink-0 text-lg font-light text-slate-300 sm:inline"
        aria-hidden="true"
      >
        →
      </span>
      <div
        className={
          changed
            ? "rounded-lg ring-2 ring-[#1d76c2]/25 ring-offset-1"
            : "min-w-0"
        }
      >
        {children}
      </div>
    </div>
  );
}

const bulkEditInputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.12)]";

const bulkEditInputDisabledClass =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600";

function scheduleRowToBulkEditDraft(
  row: ScheduleRow,
  registry: RoomDisplayRegistry,
): BulkEditLessonDraft | null {
  const parsed = parseRegularLessonRowId(row.rowId);
  if (!parsed) return null;
  const { timePreset, timeCustom } = pickTimePreset(row.time, row.weekday);
  return {
    rowId: row.rowId,
    date: row.date,
    timePreset,
    timeCustom,
    room: resolveScheduleRoomPickerValue(row.room, ROOM_GROUPS[0], registry),
    original: {
      date: row.date,
      weekday: row.weekday,
      displayTime: row.time,
      displayRoom: row.room,
      baseTime: row.baseTime,
      baseRoom: row.baseRoom,
    },
  };
}

function BulkEditLessonFields({
  draft,
  yearMin,
  yearMax,
  onChange,
  formatRoom,
  pickerLabel,
}: {
  draft: BulkEditLessonDraft;
  yearMin: string;
  yearMax: string;
  onChange: (next: BulkEditLessonDraft) => void;
  formatRoom: (raw: string) => string;
  pickerLabel: (group: RoomGroup) => string;
}) {
  const newWeekday = draft.date ? weekdayFromIsoDate(draft.date) : "";
  const newWeekdayDisplay = newWeekday ? WEEKDAY_LABEL[newWeekday] ?? newWeekday : "—";
  const finalTime = resolveBulkEditTime(draft);
  const timeOptions = timeOptionsForWeekday(newWeekday);
  const origWdLabel =
    WEEKDAY_LABEL[draft.original.weekday] ?? draft.original.weekday;
  const changed = {
    date: Boolean(draft.original.date) && draft.date.trim() !== draft.original.date?.trim(),
    weekday: newWeekdayDisplay !== origWdLabel,
    time: finalTime !== draft.original.displayTime,
    room: !scheduleRoomsMatch(draft.room, draft.original.displayRoom || ""),
  };

  return (
    <div className="divide-y divide-slate-100">
      <BulkEditCompareRow
        label="Date"
        before={formatLessonDateLabel(draft.original.date ?? "", draft.original.weekday)}
        changed={changed.date}
      >
        <input
          type="date"
          min={yearMin}
          max={yearMax}
          value={draft.date}
          onChange={(e) => {
            const v = e.target.value;
            const wd = v ? weekdayFromIsoDate(v) : "";
            const { timePreset, timeCustom } = pickTimePreset(
              draft.timeCustom || draft.timePreset,
              wd,
            );
            onChange({ ...draft, date: v, timePreset, timeCustom });
          }}
          className={bulkEditInputClass}
        />
      </BulkEditCompareRow>

      <BulkEditCompareRow label="Weekday" before={origWdLabel} changed={changed.weekday}>
        <input
          type="text"
          readOnly
          disabled
          value={newWeekdayDisplay}
          className={bulkEditInputDisabledClass}
        />
      </BulkEditCompareRow>

      <BulkEditCompareRow
        label="Time"
        before={draft.original.displayTime}
        beforeHint={
          draft.original.displayTime !== draft.original.baseTime
            ? `From schedule: ${draft.original.baseTime}`
            : undefined
        }
        changed={changed.time}
      >
        <div className="space-y-2">
          <select
            value={draft.timePreset}
            onChange={(e) => onChange({ ...draft, timePreset: e.target.value })}
            className={bulkEditInputClass}
          >
            {timeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={draft.timeCustom}
            onChange={(e) => onChange({ ...draft, timeCustom: e.target.value })}
            placeholder="Custom time (optional)"
            className={bulkEditInputClass}
          />
        </div>
      </BulkEditCompareRow>

      <BulkEditCompareRow
        label="Room"
        before={formatRoom(draft.original.displayRoom)}
        beforeHint={
          draft.original.displayRoom !== draft.original.baseRoom
            ? `From schedule: ${formatRoom(draft.original.baseRoom)}`
            : undefined
        }
        changed={changed.room}
      >
        <select
          value={draft.room}
          onChange={(e) => onChange({ ...draft, room: e.target.value })}
          className={bulkEditInputClass}
        >
          {ROOM_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {pickerLabel(option)}
            </option>
          ))}
        </select>
      </BulkEditCompareRow>
    </div>
  );
}

function timeOptionsForWeekday(wd: string): string[] {
  if (wd === "六") return [...SATURDAY_TIME_SUGGESTIONS];
  if (wd === "日") return [];
  return [...WEEKDAY_TIME_SUGGESTIONS];
}

function pickTimePreset(displayTime: string, wd: string): { timePreset: string; timeCustom: string } {
  const opts = timeOptionsForWeekday(wd);
  if (opts.includes(displayTime)) return { timePreset: displayTime, timeCustom: "" };
  if (displayTime) return { timePreset: opts[0] ?? "", timeCustom: displayTime };
  return { timePreset: opts[0] ?? "", timeCustom: "" };
}

export function StudentLessonsYearPage({ targetYear = defaultLessonYear() }: { targetYear?: number }) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = String(params?.id || "");
  const studentId = normalizeStudentId(rawId);
  const { formatRoom, pickerLabel, pickerToStorage, registry } = useRoomDisplayLabels();
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
  const [visibilityMode, setVisibilityMode] = useState<"active" | "inactive">("active");
  const [visibilityEffectiveDate, setVisibilityEffectiveDate] = useState("");
  const [visibilityReactivateDate, setVisibilityReactivateDate] = useState<string | null>(null);
  const [inactivePeriods, setInactivePeriods] = useState<StudentInactivePeriodRow[]>([]);
  const [accessReady, setAccessReady] = useState(false);
  const [isReadOnlyViewer, setIsReadOnlyViewer] = useState(false);
  const [canEditTimetableRemarks, setCanEditTimetableRemarks] = useState(false);
  const forceReadOnlyFromNext = (searchParams.get("next") || "").startsWith("/rooms/");
  const readOnly = isReadOnlyViewer;

  const [records, setRecords] = useState<ScheduleRecord[]>([]);
  const [roomSlotTutorRules, setRoomSlotTutorRules] = useState<RoomSlotTutorRule[]>([]);
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
      const isSharedByEmail =
        String(user.email ?? "").trim().toLowerCase() === TUTOR_SHARED_IPAD_EMAIL.toLowerCase();
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role, student_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const profileRow = profile as { role?: string | null; student_id?: string | null } | null;
      const role = String(profileRow?.role ?? "").toLowerCase();
      const ownStudentId = normalizeStudentId(String(profileRow?.student_id ?? ""));
      if (role === "student" && ownStudentId && ownStudentId !== studentId) {
        router.replace(studentLessonsYearPath(ownStudentId));
        return;
      }
      if (isSharedByEmail || forceReadOnlyFromNext) {
        if (mounted) {
          setIsReadOnlyViewer(true);
          setCanEditTimetableRemarks(false);
          setAccessReady(true);
        }
        return;
      }
      if (role === "tutor") {
        if (mounted) {
          setIsReadOnlyViewer(true);
          setCanEditTimetableRemarks(false);
          setAccessReady(true);
        }
        return;
      }
      if (role === "admin") {
        if (mounted) {
          setIsReadOnlyViewer(false);
          setCanEditTimetableRemarks(true);
          setAccessReady(true);
        }
        return;
      }
      if (mounted) {
        setIsReadOnlyViewer(false);
        setCanEditTimetableRemarks(false);
        setAccessReady(true);
      }
    }
    void checkAccess();
    return () => {
      mounted = false;
    };
  }, [rawId, studentId, targetYear, router, forceReadOnlyFromNext]);
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
  const [timetableRemarksByDateIso, setTimetableRemarksByDateIso] = useState<Record<string, string>>(
    {},
  );
  const timetableRemarksByDateIsoRef = useRef<Record<string, string>>({});
  const timetableRemarksSaveTimersRef = useRef<Map<string, number>>(new Map());
  const [savingTimetableRemarkDateIso, setSavingTimetableRemarkDateIso] = useState<string | null>(
    null,
  );
  const [rescheduleEntries, setRescheduleEntries] = useState<RescheduleEntry[]>([]);
  const RESCHEDULE_STORAGE_KEY = `reschedule:${studentId}:${targetYear}`;
  const [extraEntries, setExtraEntries] = useState<ExtraEntry[]>([]);
  const EXTRA_STORAGE_KEY = `extra_lessons:${studentId}:${targetYear}`;
  const [editingRescheduleId, setEditingRescheduleId] = useState<string | null>(null);
  const [fromLessonDate, setFromLessonDate] = useState<string>("");
  const [fromOriginalLessonKey, setFromOriginalLessonKey] = useState<string>("");
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
    room2: string;
    doubleEnabled: boolean;
  }>({
    date: "",
    timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
    timeCustom: "",
    room: ROOM_OPTIONS[0],
    room2: ROOM_OPTIONS[0],
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
  const [showBulkEditPanel, setShowBulkEditPanel] = useState(false);
  const [bulkEditMode, setBulkEditMode] = useState<BulkEditMode>("single");
  const [bulkEditLessonDrafts, setBulkEditLessonDrafts] = useState<BulkEditLessonDraft[]>([]);
  const [bulkEditForm, setBulkEditForm] = useState<BulkEditFormState>({
    date: "",
    newWeekday: "",
    timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
    timeCustom: "",
    room: ROOM_OPTIONS[0],
    effectiveDate: "",
    sourceRuleId: "",
    selectedDateIsos: [],
    sourceSlotLabel: "",
    original: {
      weekday: "",
      displayTime: "",
      displayRoom: "",
      baseTime: "",
      baseRoom: "",
    },
  });
  const [bulkEditSaveStatus, setBulkEditSaveStatus] = useState("");
  const [showRowEditPanel, setShowRowEditPanel] = useState(false);
  const [rowEditSession, setRowEditSession] = useState<RowEditSession | null>(null);
  const [rowEditSaveStatus, setRowEditSaveStatus] = useState("");
  const [rowEditConfirm, setRowEditConfirm] = useState<RowEditConfirmPayload | null>(null);
  const rowEditPanelRef = useRef<HTMLDivElement>(null);
  const [cloudSaveNotice, setCloudSaveNotice] = useState("");
  const [cloudSaveFailed, setCloudSaveFailed] = useState(false);
  const cloudSaveKindRef = useRef<"year" | "records">("year");
  const awaitingBulkEditSyncRef = useRef(false);
  const reschedulePanelRef = useRef<HTMLDivElement>(null);
  const [filterMonth, setFilterMonth] = useState(() => {
    const hk = hkYmdNow();
    if (hk.y === targetYear) return String(hk.m);
    return String(targetYear === LESSON_SYSTEM_START_YEAR ? LESSON_SYSTEM_START_MONTH : 1);
  });
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
  const scheduleTableColSpan = canEditTimetableRemarks ? 12 : 11;

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
    if (isReadOnlyViewer) return;
    if (!studentId) return;
    const mergedState: StudentLesson2026State = {
      attendance: next.attendance ?? attendanceRef.current,
      hiddenDates: next.hiddenDates ?? hiddenDatesRef.current,
      overrides: next.overrides ?? overridesRef.current,
      rescheduleEntries: next.rescheduleEntries ?? rescheduleEntriesRef.current,
      extraEntries: next.extraEntries ?? extraEntriesRef.current,
    };
    const dirtyFieldSet = new Set(lessonYearStateFieldsFromPatch(next));
    queueSaveLessonYearState(
      studentId,
      targetYear,
      mergedState,
      [...dirtyFieldSet],
    );
  }

  useEffect(() => {
    overridesRef.current = overrides;
    attendanceRef.current = attendance;
    hiddenDatesRef.current = hiddenDates;
    rescheduleEntriesRef.current = rescheduleEntries;
    extraEntriesRef.current = extraEntries;
    lessonSummaryDraftByDateIsoRef.current = lessonSummaryDraftByDateIso;
  }, [attendance, hiddenDates, overrides, rescheduleEntries, extraEntries, lessonSummaryDraftByDateIso]);

  const applyYearStateToUi = useCallback(
    (state: {
      attendance: Record<string, boolean>;
      hiddenDates: Record<string, boolean>;
      overrides: Record<string, DayOverride>;
      rescheduleEntries: RescheduleEntry[];
      extraEntries: ExtraEntry[];
    }) => {
      const nextReschedule = (state.rescheduleEntries ?? []).map((e) => ({
        ...e,
        id: String(e.id),
        fromDate: String(e.fromDate ?? ""),
        toDate: String(e.toDate ?? ""),
        time: String(e.time ?? ""),
        room: String(e.room ?? ""),
        ...(e.fromScheduleRuleId
          ? { fromScheduleRuleId: String(e.fromScheduleRuleId) }
          : {}),
        ...(e.fromTime ? { fromTime: String(e.fromTime) } : {}),
        ...(e.fromRoom ? { fromRoom: String(e.fromRoom) } : {}),
      }));
      const nextExtra = (state.extraEntries ?? []).map((e) => ({
        ...e,
        id: String(e.id),
        date: String(e.date ?? ""),
        time: String(e.time ?? ""),
        room: String(e.room ?? ""),
      }));
      setAttendance(state.attendance);
      setHiddenDates(state.hiddenDates);
      setOverrides(state.overrides);
      setRescheduleEntries(nextReschedule);
      setExtraEntries(nextExtra);
      window.localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(state.attendance));
      window.localStorage.setItem(HIDDEN_DATES_STORAGE_KEY, JSON.stringify(state.hiddenDates));
      window.localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(state.overrides));
      window.localStorage.setItem(RESCHEDULE_STORAGE_KEY, JSON.stringify(nextReschedule));
      window.localStorage.setItem(EXTRA_STORAGE_KEY, JSON.stringify(nextExtra));
    },
    [
      ATTENDANCE_STORAGE_KEY,
      HIDDEN_DATES_STORAGE_KEY,
      OVERRIDES_STORAGE_KEY,
      RESCHEDULE_STORAGE_KEY,
      EXTRA_STORAGE_KEY,
    ],
  );

  const onRemoteYearState = useCallback(
    (remote: StudentLesson2026State) => {
      applyYearStateToUi({
        attendance: remote.attendance,
        hiddenDates: remote.hiddenDates,
        overrides: (remote.overrides ?? {}) as Record<string, DayOverride>,
        rescheduleEntries: (remote.rescheduleEntries ?? []) as RescheduleEntry[],
        extraEntries: (remote.extraEntries ?? []) as ExtraEntry[],
      });
    },
    [applyYearStateToUi],
  );

  useStudentLessonYearStateRealtime(accessReady ? studentId : "", targetYear, onRemoteYearState);

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
    if (!studentId || !accessReady || !canEditTimetableRemarks) {
      setTimetableRemarksByDateIso({});
      timetableRemarksByDateIsoRef.current = {};
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const remarks = await loadTimetableDayRemarksForStudent(studentId, yearMin, yearMax);
        if (mounted) {
          setTimetableRemarksByDateIso(remarks);
          timetableRemarksByDateIsoRef.current = remarks;
        }
      } catch {
        if (mounted) {
          setTimetableRemarksByDateIso({});
          timetableRemarksByDateIsoRef.current = {};
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [studentId, accessReady, canEditTimetableRemarks, yearMin, yearMax]);

  useEffect(() => {
    if (!studentId || !accessReady) return;
    const scheduleKey = `lesson_schedule_records:${studentId}`;
    let mounted = true;
    setStudentLoaded(false);
    setStudentNotFound(false);

    function readYearStateFromLocalStorage() {
      const readJson = <T,>(key: string, fallback: T): T => {
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) return fallback;
          return JSON.parse(raw) as T;
        } catch {
          return fallback;
        }
      };
      return {
        attendance: readJson<Record<string, boolean>>(ATTENDANCE_STORAGE_KEY, {}),
        hiddenDates: readJson<Record<string, boolean>>(HIDDEN_DATES_STORAGE_KEY, {}),
        overrides: readJson<Record<string, DayOverride>>(OVERRIDES_STORAGE_KEY, {}),
        rescheduleEntries: readJson<RescheduleEntry[]>(RESCHEDULE_STORAGE_KEY, []),
        extraEntries: readJson<ExtraEntry[]>(EXTRA_STORAGE_KEY, []),
      };
    }

    function applyYearState(state: {
      attendance: Record<string, boolean>;
      hiddenDates: Record<string, boolean>;
      overrides: Record<string, DayOverride>;
      rescheduleEntries: RescheduleEntry[];
      extraEntries: ExtraEntry[];
    }) {
      if (!mounted) return;
      setAttendance(state.attendance);
      setHiddenDates(state.hiddenDates);
      setOverrides(state.overrides);
      setRescheduleEntries(state.rescheduleEntries);
      setExtraEntries(state.extraEntries);
      window.localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(state.attendance));
      window.localStorage.setItem(HIDDEN_DATES_STORAGE_KEY, JSON.stringify(state.hiddenDates));
      window.localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(state.overrides));
      window.localStorage.setItem(RESCHEDULE_STORAGE_KEY, JSON.stringify(state.rescheduleEntries));
      window.localStorage.setItem(EXTRA_STORAGE_KEY, JSON.stringify(state.extraEntries));
    }

    void (async () => {
      try {
        const res = await fetch(
          `/api/students/${encodeURIComponent(studentId)}/lessons-bootstrap?year=${targetYear}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!res.ok) throw new Error("bootstrap failed");
        const body = (await res.json()) as {
          ok?: boolean;
          student?: {
            id: string;
            name_zh?: string | null;
            name_en?: string | null;
            nickname_en?: string | null;
            grade?: string | null;
            school?: string | null;
            textbook_publisher?: string | null;
          } | null;
          examInfo?: { examDate?: string; examContent?: string };
          scheduleRecords?: unknown[];
          yearState?: {
            attendance?: Record<string, boolean>;
            hiddenDates?: Record<string, boolean>;
            overrides?: Record<string, DayOverride>;
            rescheduleEntries?: RescheduleEntry[];
            extraEntries?: ExtraEntry[];
          };
          visibilityMode?: {
            mode?: string;
            effective_date?: string;
            reactivate_date?: string | null;
          };
          inactivePeriods?: StudentInactivePeriodRow[];
          roomSlotTutorRules?: RoomSlotTutorRule[];
        };
        if (!mounted) return;

        setExamInfo({
          examDate: body.examInfo?.examDate ?? "",
          examContent: body.examInfo?.examContent ?? "",
        });

        const data = body.student;
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
        const vis = body.visibilityMode;
        const rawVisMode = String(vis?.mode ?? "active").toLowerCase();
        setVisibilityMode(rawVisMode === "inactive" ? "inactive" : "active");
        setVisibilityEffectiveDate(String(vis?.effective_date ?? ""));
        setVisibilityReactivateDate(
          typeof vis?.reactivate_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(vis.reactivate_date)
            ? vis.reactivate_date
            : null,
        );
        setInactivePeriods(
          Array.isArray(body.inactivePeriods)
            ? body.inactivePeriods.map((row) => ({
                student_id: String(row.student_id ?? studentId),
                start_date: String(row.start_date ?? ""),
                end_date:
                  typeof row.end_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.end_date)
                    ? row.end_date
                    : null,
                note: String(row.note ?? ""),
              }))
            : [],
        );
        setStudentNotFound(false);
        setStudentLoaded(true);
        setRoomSlotTutorRules(Array.isArray(body.roomSlotTutorRules) ? body.roomSlotTutorRules : []);

        const cloudRecords = body.scheduleRecords;
        if (Array.isArray(cloudRecords) && cloudRecords.length > 0) {
          const normalized = (cloudRecords as ScheduleRecord[]).map((r) => ({
            ...r,
            effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
          }));
          setRecords(normalized);
          window.localStorage.setItem(scheduleKey, JSON.stringify(normalized));
        } else {
          try {
            const raw = window.localStorage.getItem(scheduleKey);
            if (raw) {
              const parsed = JSON.parse(raw) as ScheduleRecord[];
              if (Array.isArray(parsed)) setRecords(parsed);
            }
          } catch {
            // ignore
          }
        }

        const cloud = body.yearState;
        if (cloud) {
          applyYearState({
            attendance: (cloud.attendance ?? {}) as Record<string, boolean>,
            hiddenDates: (cloud.hiddenDates ?? {}) as Record<string, boolean>,
            overrides: (cloud.overrides ?? {}) as Record<string, DayOverride>,
            rescheduleEntries: (cloud.rescheduleEntries ?? []) as RescheduleEntry[],
            extraEntries: (cloud.extraEntries ?? []) as ExtraEntry[],
          });
        } else {
          applyYearState(readYearStateFromLocalStorage());
        }
      } catch {
        if (!mounted) return;
        applyYearState(readYearStateFromLocalStorage());
        setStudentLoaded(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [studentId, targetYear, accessReady, ATTENDANCE_STORAGE_KEY, HIDDEN_DATES_STORAGE_KEY, OVERRIDES_STORAGE_KEY, RESCHEDULE_STORAGE_KEY, EXTRA_STORAGE_KEY]);

  useEffect(() => {
    if (!studentId || !accessReady) return;

    let cancelled = false;

    async function reloadYearStateFromCloud() {
      try {
        const res = await fetch(
          `/api/students/${encodeURIComponent(studentId)}/lessons-bootstrap?year=${targetYear}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          inactivePeriods?: StudentInactivePeriodRow[];
          yearState?: {
            attendance?: Record<string, boolean>;
            hiddenDates?: Record<string, boolean>;
            overrides?: Record<string, DayOverride>;
            rescheduleEntries?: RescheduleEntry[];
            extraEntries?: ExtraEntry[];
          };
        };
        if (Array.isArray(body.inactivePeriods)) {
          setInactivePeriods(
            body.inactivePeriods.map((row) => ({
              student_id: String(row.student_id ?? studentId),
              start_date: String(row.start_date ?? ""),
              end_date:
                typeof row.end_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.end_date)
                  ? row.end_date
                  : null,
              note: String(row.note ?? ""),
            })),
          );
        }
        const cloud = body.yearState;
        if (!cloud || cancelled) return;

        const nextAttendance = (cloud.attendance ?? {}) as Record<string, boolean>;
        const nextHiddenDates = (cloud.hiddenDates ?? {}) as Record<string, boolean>;
        const nextOverrides = (cloud.overrides ?? {}) as Record<string, DayOverride>;
        const nextReschedule = (cloud.rescheduleEntries ?? []) as RescheduleEntry[];
        const nextExtra = (cloud.extraEntries ?? []) as ExtraEntry[];

        applyYearStateToUi({
          attendance: nextAttendance,
          hiddenDates: nextHiddenDates,
          overrides: nextOverrides,
          rescheduleEntries: nextReschedule,
          extraEntries: nextExtra,
        });
      } catch {
        // ignore background refresh errors
      }
    }

    const unsub = subscribeLessonSaveStatus((evt) => {
      if (evt.studentId !== studentId) return;
      if (evt.kind !== "year" || evt.year !== targetYear) return;
      // Avoid clobbering a just-saved local edit with a raced bootstrap read.
      if (evt.status === "saved") {
        if (hasPendingLessonYearStateSaves()) return;
        void reloadYearStateFromCloud();
      }
    });

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void reloadYearStateFromCloud();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      unsub();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    studentId,
    targetYear,
    accessReady,
    ATTENDANCE_STORAGE_KEY,
    HIDDEN_DATES_STORAGE_KEY,
    OVERRIDES_STORAGE_KEY,
    RESCHEDULE_STORAGE_KEY,
    EXTRA_STORAGE_KEY,
    applyYearStateToUi,
  ]);

  useEffect(() => {
    if (!studentId) return;
    return subscribeLessonSaveStatus((evt) => {
      if (evt.studentId !== studentId) return;
      if (evt.kind === "year" && evt.year !== targetYear) return;

      if (evt.status === "saving") {
        setCloudSaveFailed(false);
        setCloudSaveNotice("雲端同步中…");
        return;
      }

      if (evt.status === "saved") {
        setCloudSaveFailed(false);
        setCloudSaveNotice("已同步雲端");
        window.setTimeout(() => {
          setCloudSaveNotice((prev) => (prev === "已同步雲端" ? "" : prev));
        }, 2500);
        if (awaitingBulkEditSyncRef.current) {
          awaitingBulkEditSyncRef.current = false;
          setBulkEditSaveStatus("Synced.");
          setSelectionError("Synced.");
          window.setTimeout(() => {
            setBulkEditSaveStatus("");
            setSelectionError((prev) => (prev === "Synced." ? "" : prev));
            setShowBulkEditPanel(false);
            setBulkEditLessonDrafts([]);
            setSelectedRowIds([]);
          }, 1200);
        }
        return;
      }

      if (evt.status === "failed") {
        cloudSaveKindRef.current = evt.kind;
        setCloudSaveFailed(true);
        setCloudSaveNotice(evt.message ?? "雲端儲存失敗，請重試");
        if (awaitingBulkEditSyncRef.current) {
          awaitingBulkEditSyncRef.current = false;
          setBulkEditSaveStatus("Sync failed.");
          setSelectionError("Sync failed.");
        }
      }
    });
  }, [studentId, targetYear]);

  useEffect(() => {
    if (!showBulkEditPanel && !showEditPanel) return;
    const frame = window.requestAnimationFrame(() => {
      reschedulePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showBulkEditPanel, showEditPanel, showRowEditPanel]);

  useEffect(() => {
    if (!showRowEditPanel) return;
    const frame = window.requestAnimationFrame(() => {
      rowEditPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showRowEditPanel]);

  function retryCloudSave() {
    if (!studentId) return;
    if (cloudSaveKindRef.current === "records") {
      retrySaveLessonScheduleRecords(studentId);
      return;
    }
    retrySaveLessonYearState(studentId, targetYear);
  }

  const hkTodayYmd = useMemo(() => toHkIsoDateFromMs(Date.now()), []);

  const visibleExamInfo = useMemo(
    () => ({
      examDate: visibleExamDateIso(examInfo.examDate, hkTodayYmd),
      examContent: visibleExamContent(examInfo.examDate, examInfo.examContent, hkTodayYmd),
    }),
    [examInfo, hkTodayYmd],
  );
  const showExamInfo = isUpcomingExamDate(examInfo.examDate, hkTodayYmd);

  const scheduleBuildOptions = useMemo((): StudentScheduleBuildOptions | undefined => {
    const from = filterDateFrom.trim();
    const to = filterDateTo.trim();
    const slotRules =
      roomSlotTutorRules.length > 0 ? { roomSlotTutorRules } : {};
    if (from && to) {
      return { rangeStartIso: from, rangeEndIso: to, ...slotRules };
    }
    if (filterMonth) {
      return { month: Number(filterMonth), ...slotRules };
    }
    return Object.keys(slotRules).length ? slotRules : undefined;
  }, [filterDateFrom, filterDateTo, filterMonth, roomSlotTutorRules]);

  const scheduleMapperState = useMemo(
    () => ({
      hiddenDates,
      overrides,
      rescheduleEntries,
      extraEntries,
    }),
    [hiddenDates, overrides, rescheduleEntries, extraEntries],
  );

  const isLessonDateHiddenByInactivePeriod = useMemo(
    () =>
      makeStudentInactiveDateCheckerFromPeriods({
        periods: inactivePeriods.map((period) => ({
          studentId: period.student_id,
          startDate: period.start_date,
          endDate: period.end_date,
          note: period.note,
        })),
        studentId,
        grade: studentSummary.grade,
        year: targetYear,
      }),
    [inactivePeriods, studentId, studentSummary.grade, targetYear],
  );

  /** Full-year regular lesson dates for reschedule validation (not month/range filtered). */
  const validationBaseRowsByDate = useMemo(() => {
    if (!studentId) return new Map<string, ScheduleRow[]>();
    const rows = buildStudentBaseScheduleRows(records, scheduleMapperState, targetYear, hkTodayYmd).filter(
      (r) => !isLessonDateHiddenByInactivePeriod(r.date),
    );
    const map = new Map<string, ScheduleRow[]>();
    for (const r of rows) {
      const list = map.get(r.date) ?? [];
      list.push(r);
      map.set(r.date, list);
    }
    return map;
  }, [
    records,
    studentId,
    scheduleMapperState,
    targetYear,
    hkTodayYmd,
    isLessonDateHiddenByInactivePeriod,
  ]);

  /** Prefer first regular row for a date (legacy single-slot helpers). */
  const validationBaseRowByDate = useMemo(() => {
    const map = new Map<string, ScheduleRow>();
    for (const [date, list] of validationBaseRowsByDate) {
      if (list[0]) map.set(date, list[0]);
    }
    return map;
  }, [validationBaseRowsByDate]);

  const fromDateOriginalLessons = useMemo(() => {
    if (!fromLessonDate) return [] as ScheduleRow[];
    return validationBaseRowsByDate.get(fromLessonDate) ?? [];
  }, [fromLessonDate, validationBaseRowsByDate]);

  const selectedFromOriginalLesson = useMemo(() => {
    if (!fromOriginalLessonKey) return fromDateOriginalLessons[0] ?? null;
    return (
      fromDateOriginalLessons.find((r) => originalLessonSlotKey(r) === fromOriginalLessonKey) ??
      fromDateOriginalLessons[0] ??
      null
    );
  }, [fromDateOriginalLessons, fromOriginalLessonKey]);

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

  const scheduleRows = useMemo(() => {
    if (!studentId) return [];
    return buildStudentScheduleRows(records, scheduleMapperState, targetYear, hkTodayYmd, scheduleBuildOptions).filter(
      (r) => keepScheduleRowVisibleDuringInactive(r) || !isLessonDateHiddenByInactivePeriod(r.date),
    );
  }, [
    records,
    studentId,
    scheduleMapperState,
    targetYear,
    hkTodayYmd,
    scheduleBuildOptions,
    isLessonDateHiddenByInactivePeriod,
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
        case "attendance": {
          const attendedA =
            a.rowKind === "normal" && a.scheduleRuleId
              ? isRegularLessonAttended(attendance, { id: a.scheduleRuleId }, a.date)
              : Boolean(attendance[a.attendanceKey]);
          const attendedB =
            b.rowKind === "normal" && b.scheduleRuleId
              ? isRegularLessonAttended(attendance, { id: b.scheduleRuleId }, b.date)
              : Boolean(attendance[b.attendanceKey]);
          result = (attendedA ? 1 : 0) - (attendedB ? 1 : 0);
          break;
        }
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

  const monthFilterOptions = useMemo(() => {
    const start = targetYear === LESSON_SYSTEM_START_YEAR ? LESSON_SYSTEM_START_MONTH : 1;
    return Array.from({ length: 12 - start + 1 }, (_, i) => start + i);
  }, [targetYear]);
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

  const hiddenScheduleKeys = useMemo(() => listHiddenScheduleKeys(hiddenDates), [hiddenDates]);

  function persistHiddenDates(next: Record<string, boolean>) {
    if (isReadOnlyViewer) return;
    setHiddenDates(next);
    window.localStorage.setItem(HIDDEN_DATES_STORAGE_KEY, JSON.stringify(next));
    persistYearState({ hiddenDates: next });
  }

  function persistScheduleRecords(next: ScheduleRecord[]) {
    if (isReadOnlyViewer) return;
    const key = `lesson_schedule_records:${studentId}`;
    setRecords(next);
    window.localStorage.setItem(key, JSON.stringify(next));
    queueSaveLessonScheduleRecords(studentId, next);
  }

  function persistOverrides(next: Record<string, DayOverride>) {
    if (isReadOnlyViewer) return;
    setOverrides(next);
    overridesRef.current = next;
    window.localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(next));
    persistYearState({ overrides: next });
  }

  const bulkEditTimeOptions = useMemo(() => {
    const wd = bulkEditForm.date ? weekdayFromIsoDate(bulkEditForm.date) : "";
    return timeOptionsForWeekday(wd);
  }, [bulkEditForm.date]);

  const bulkEditNewWeekdayDisplay = useMemo(() => {
    if (!bulkEditForm.date) return "—";
    const wd = weekdayFromIsoDate(bulkEditForm.date);
    return WEEKDAY_LABEL[wd] ?? wd;
  }, [bulkEditForm.date]);

  const bulkEditFinalTime = useMemo(() => resolveBulkEditTime(bulkEditForm), [bulkEditForm]);

  const bulkEditFieldChanged = useMemo(
    () => ({
      date:
        bulkEditMode === "single" &&
        Boolean(bulkEditForm.original.date) &&
        bulkEditForm.date.trim() !== bulkEditForm.original.date?.trim(),
      weekday:
        bulkEditNewWeekdayDisplay !==
        (WEEKDAY_LABEL[bulkEditForm.original.weekday] ?? bulkEditForm.original.weekday),
      time: bulkEditFinalTime !== bulkEditForm.original.displayTime,
      room: !scheduleRoomsMatch(
        bulkEditForm.room,
        bulkEditForm.original.displayRoom || "",
      ),
    }),
    [bulkEditMode, bulkEditForm, bulkEditNewWeekdayDisplay, bulkEditFinalTime],
  );

  function openClassicReschedulePanel(opts?: {
    row?: ScheduleRow;
    fromDate?: string;
    toDate?: string;
    lockFrom?: boolean;
    editingId?: string | null;
  }) {
    setShowBulkEditPanel(false);
    setReschedulePanelMode("reschedule");
    setShowExtraPanel(false);
    setShowRowEditPanel(false);
    setRowEditSession(null);
    setRowEditConfirm(null);

    if (opts?.row && opts.row.rowKind !== "normal") {
      const entry = opts.row.rescheduleEntryId
        ? rescheduleEntryById.get(opts.row.rescheduleEntryId)
        : undefined;
      if (!entry) {
        setSelectionError("Cannot find the corresponding reschedule record.");
        return;
      }
      setEditingRescheduleId(entry.id);
      setFromLessonDate(entry.fromDate);
      setFromOriginalLessonKey(
        entry.fromScheduleRuleId || entry.fromTime || entry.fromRoom
          ? originalLessonSlotKey(entry)
          : "",
      );
      setToLessonDate(isPendingRescheduleEntry(entry) ? "" : entry.toDate);
      setLockFromLessonDate(true);
      const wd = weekdayFromIsoDate(
        isPendingRescheduleEntry(entry) ? entry.fromDate : entry.toDate,
      );
      const timeOpts = wd === "六" ? SATURDAY_TIME_SUGGESTIONS : WEEKDAY_TIME_SUGGESTIONS;
      setEditForm({
        timePreset: timeOpts.includes(entry.time) ? entry.time : timeOpts[0],
        timeCustom: timeOpts.includes(entry.time) ? "" : entry.time,
        room: resolveScheduleRoomPickerValue(entry.room, ROOM_GROUPS[0], registry),
        doubleEnabled: false,
      });
      setShowEditPanel(true);
      return;
    }

    setEditingRescheduleId(opts?.editingId ?? null);
    setFromLessonDate(opts?.fromDate ?? "");
    setFromOriginalLessonKey(opts?.row?.rowKind === "normal" ? originalLessonSlotKey(opts.row) : "");
    setToLessonDate(opts?.toDate ?? toHkIsoDateFromMs(Date.now()));
    setLockFromLessonDate(opts?.lockFrom ?? false);
    if (opts?.row?.rowKind === "normal") {
      const wd = weekdayFromIsoDate(opts.row.date);
      const timeOpts = wd === "六" ? SATURDAY_TIME_SUGGESTIONS : WEEKDAY_TIME_SUGGESTIONS;
      setEditForm({
        timePreset: timeOpts.includes(opts.row.time) ? opts.row.time : timeOpts[0],
        timeCustom: timeOpts.includes(opts.row.time) ? "" : opts.row.time,
        room: resolveScheduleRoomPickerValue(opts.row.room, ROOM_GROUPS[0], registry),
        doubleEnabled: false,
      });
    } else {
      setEditForm({
        timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
        timeCustom: "",
        room: ROOM_OPTIONS[0],
        doubleEnabled: false,
      });
    }
    setShowEditPanel(true);
  }

  /** Regular rows: one lesson (1 row) or weekly slot (2+). Returns false if selection invalid. */
  function tryOpenBulkReschedulePanel(): boolean {
    setBulkEditSaveStatus("");
    setShowEditPanel(false);
    setShowExtraPanel(false);
    setShowRowEditPanel(false);
    setRowEditSession(null);
    setRowEditConfirm(null);

    const selectedRows = selectedRowIds
      .map((id) => scheduleRowById.get(id))
      .filter((r): r is ScheduleRow => Boolean(r));

    if (selectedRows.length === 0) return false;

    const regularRows = selectedRows.filter((r) => r.rowKind === "normal" && !r.extraEntryId);
    if (regularRows.length === 0) {
      setSelectionError("Only regular lesson rows can be rescheduled here. For reschedule rows, use Reschedule with that row selected.");
      return false;
    }
    if (regularRows.length !== selectedRows.length) {
      setSelectionError("Remove reschedule, cancelled, extra, or pending rows from the selection.");
      return false;
    }

    if (regularRows.length === 1) {
      const row = regularRows[0];
      const parsed = parseRegularLessonRowId(row.rowId);
      if (!parsed) {
        setSelectionError("Cannot edit this row (missing schedule rule link).");
        return false;
      }
      const { timePreset, timeCustom } = pickTimePreset(row.time, row.weekday);
      setBulkEditMode("single");
      setBulkEditLessonDrafts([]);
      setBulkEditForm({
        date: row.date,
        newWeekday: row.weekday,
        timePreset,
        timeCustom,
        room: resolveScheduleRoomPickerValue(row.room, ROOM_GROUPS[0], registry),
        effectiveDate: row.date,
        sourceRuleId: parsed.ruleId,
        selectedDateIsos: [row.date],
        sourceSlotLabel: `${WEEKDAY_LABEL[row.weekday] ?? row.weekday} ${row.baseTime} · ${formatRoom(row.baseRoom)}`,
        original: {
          date: row.date,
          weekday: row.weekday,
          displayTime: row.time,
          displayRoom: row.room,
          baseTime: row.baseTime,
          baseRoom: row.baseRoom,
        },
      });
      setShowBulkEditPanel(true);
      return true;
    }

    const sortedRows = [...regularRows].sort((a, b) => a.date.localeCompare(b.date));
    const drafts: BulkEditLessonDraft[] = [];
    for (const row of sortedRows) {
      const draft = scheduleRowToBulkEditDraft(row, registry);
      if (!draft) {
        setSelectionError("Cannot edit this selection (missing schedule rule link).");
        return false;
      }
      drafts.push(draft);
    }

    setBulkEditMode("each");
    setBulkEditLessonDrafts(drafts);
    setShowBulkEditPanel(true);
    return true;
  }

  function openRescheduleFromSelection() {
    setSelectionError("");
    setReschedulePanelMode("reschedule");

    const selectedRows = selectedRowIds
      .map((id) => scheduleRowById.get(id))
      .filter((r): r is ScheduleRow => Boolean(r));

    if (selectedRows.length === 0) {
      openClassicReschedulePanel();
      return;
    }

    if (selectedRows.length === 1) {
      const row = selectedRows[0];
      if (row.rowKind !== "normal" || row.extraEntryId) {
        openClassicReschedulePanel({ row });
        return;
      }
      if (tryOpenBulkReschedulePanel()) return;
      return;
    }

    if (tryOpenBulkReschedulePanel()) return;
  }

  function closeRowEditPanel() {
    setShowRowEditPanel(false);
    setRowEditSession(null);
    setRowEditSaveStatus("");
    setRowEditConfirm(null);
  }

  function openRowEditFromSelection() {
    if (readOnly) return;
    setSelectionError("");
    setRowEditSaveStatus("");
    setRowEditConfirm(null);

    if (selectedRowIds.length === 0) {
      setSelectionError("Select 1 lesson row to edit.");
      return;
    }
    if (selectedRowIds.length > 1) {
      setSelectionError("Edit one lesson at a time — select only 1 row.");
      return;
    }

    const row = scheduleRowById.get(selectedRowIds[0]);
    if (!row) {
      setSelectionError("Cannot find the selected lesson row.");
      return;
    }

    if (row.rowKind === "cancelled_original") {
      setSelectionError("Cancelled rows cannot be edited here. Select the Reschedule row instead.");
      return;
    }

    const { timePreset, timeCustom } = pickTimePreset(row.time, row.weekday);
    const draft: BulkEditLessonDraft = {
      rowId: row.rowId,
      date: row.date,
      timePreset,
      timeCustom,
      room: resolveScheduleRoomPickerValue(row.room, ROOM_GROUPS[0], registry),
      original: {
        date: row.date,
        weekday: row.weekday,
        displayTime: row.time,
        displayRoom: row.room,
        baseTime: row.baseTime,
        baseRoom: row.baseRoom,
      },
    };

    let session: RowEditSession | null = null;
    if (row.extraEntryId) {
      session = { kind: "extra", rowId: row.rowId, entryId: row.extraEntryId, draft };
    } else if (row.rowKind === "reschedule" && row.rescheduleEntryId) {
      session = {
        kind: "reschedule",
        rowId: row.rowId,
        entryId: row.rescheduleEntryId,
        originalFromDate: row.rescheduleFromDate,
        draft,
      };
    } else if (row.rowKind === "normal") {
      session = {
        kind: "regular",
        rowId: row.rowId,
        originalFromDate: row.date,
        draft,
      };
    } else {
      setSelectionError("This row type cannot be edited here.");
      return;
    }

    setShowBulkEditPanel(false);
    setShowEditPanel(false);
    setShowExtraPanel(false);
    setRowEditSession(session);
    setShowRowEditPanel(true);
  }

  function requestRowEditConfirm() {
    if (readOnly || !rowEditSession) return;
    setRowEditSaveStatus("");
    setSelectionError("");

    const draft = rowEditSession.draft;
    const finalTime = resolveBulkEditTime(draft);
    const finalRoom = pickerToStorage(draft.room.trim());
    const newDate = draft.date.trim();

    if (!newDate) {
      setRowEditSaveStatus("Please choose a lesson date.");
      setSelectionError("Please choose a lesson date.");
      return;
    }
    if (newDate < yearMin || newDate > yearMax) {
      setRowEditSaveStatus(`Date must be within ${targetYear}.`);
      setSelectionError(`Date must be within ${targetYear}.`);
      return;
    }
    if (!finalTime) {
      setRowEditSaveStatus("Please select or enter a lesson time.");
      setSelectionError("Please select or enter a lesson time.");
      return;
    }
    if (!finalRoom) {
      setRowEditSaveStatus("Please select a room.");
      setSelectionError("Please select a room.");
      return;
    }

    const newWeekday = weekdayFromIsoDate(newDate);
    const before = {
      date: draft.original.date ?? "",
      weekday: draft.original.weekday,
      time: draft.original.displayTime,
      room: draft.original.displayRoom,
    };
    const after = {
      date: newDate,
      weekday: newWeekday,
      time: finalTime,
      room: finalRoom,
    };

    if (
      before.date === after.date &&
      before.time === after.time &&
      before.room === after.room
    ) {
      setRowEditSaveStatus("No changes to save.");
      return;
    }

    if (rowEditSession.kind === "regular") {
      const originalDate = rowEditSession.originalFromDate ?? draft.original.date ?? "";
      if (!validationBaseRowByDate.has(originalDate)) {
        setRowEditSaveStatus("Original date is not a regular lesson date.");
        setSelectionError("Original date must be an existing regular lesson date.");
        return;
      }
      const timeOrDateChanged =
        newDate !== originalDate || finalTime !== (draft.original.baseTime || draft.original.displayTime);
      if (timeOrDateChanged) {
        const sourceRow = scheduleRowById.get(rowEditSession.rowId);
        const fromSlotKey = originalLessonSlotKey({
          scheduleRuleId: sourceRow?.scheduleRuleId,
          baseTime: draft.original.baseTime || draft.original.displayTime,
          baseRoom: draft.original.baseRoom || draft.original.displayRoom,
        });
        const slotConflict = rescheduleEntries.some((e) => {
          if (e.fromDate !== originalDate) return false;
          if (!e.fromScheduleRuleId && !e.fromTime && !e.fromRoom) return true;
          return originalLessonSlotKey(e) === fromSlotKey;
        });
        if (slotConflict) {
          setRowEditSaveStatus("This lesson already has a reschedule. Edit the Reschedule row instead.");
          setSelectionError("This lesson already has a reschedule. Edit the Reschedule row instead.");
          return;
        }
      }
      const sourceRow = scheduleRowById.get(rowEditSession.rowId);
      setRowEditConfirm({
        kind: "regular",
        originalFromDate: originalDate,
        scheduleRuleId: sourceRow?.scheduleRuleId,
        baseTime: draft.original.baseTime,
        baseRoom: draft.original.baseRoom,
        newDate,
        finalTime,
        finalRoom,
        before,
        after,
      });
      return;
    }

    if (rowEditSession.kind === "extra") {
      if (!rowEditSession.entryId) {
        setRowEditSaveStatus("Missing extra lesson id.");
        return;
      }
      setRowEditConfirm({
        kind: "extra",
        entryId: rowEditSession.entryId,
        newDate,
        finalTime,
        finalRoom,
        before,
        after,
      });
      return;
    }

    if (!rowEditSession.entryId) {
      setRowEditSaveStatus("Missing reschedule id.");
      return;
    }
    setRowEditConfirm({
      kind: "reschedule",
      entryId: rowEditSession.entryId,
      originalFromDate: rowEditSession.originalFromDate,
      newDate,
      finalTime,
      finalRoom,
      before,
      after,
    });
  }

  function confirmRowEditSave() {
    if (readOnly || !rowEditConfirm) return;
    const payload = rowEditConfirm;

    if (payload.kind === "regular") {
      const originalDate = payload.originalFromDate ?? "";
      const timeOrDateChanged =
        payload.newDate !== originalDate ||
        payload.finalTime !== (payload.baseTime || payload.before.time);
      if (timeOrDateChanged) {
        const nextList = [
          ...rescheduleEntries,
          {
            id: `${Date.now()}`,
            fromDate: originalDate,
            toDate: payload.newDate,
            time: payload.finalTime,
            room: payload.finalRoom,
            ...fromSlotFieldsFromRow({
              scheduleRuleId: payload.scheduleRuleId,
              baseTime: payload.baseTime || payload.before.time,
              baseRoom: payload.baseRoom || payload.before.room,
            }),
          },
        ];
        setRescheduleEntries(nextList);
        rescheduleEntriesRef.current = nextList;
        window.localStorage.setItem(RESCHEDULE_STORAGE_KEY, JSON.stringify(nextList));
        persistYearState({ rescheduleEntries: nextList });
        const nextOverrides = { ...overridesRef.current };
        delete nextOverrides[originalDate];
        persistOverrides(nextOverrides);
      } else {
        const nextOverrides = { ...overridesRef.current };
        if (
          scheduleRoomsMatch(
            payload.finalRoom,
            payload.baseRoom || payload.before.room,
          )
        ) {
          delete nextOverrides[originalDate];
        } else {
          nextOverrides[originalDate] = {
            ...(nextOverrides[originalDate] ?? {}),
            room: payload.finalRoom,
          };
        }
        persistOverrides(nextOverrides);
      }
    } else if (payload.kind === "extra") {
      const entryId = String(payload.entryId ?? "");
      const nextExtra = extraEntries.map((e) =>
        String(e.id) === entryId
          ? { ...e, id: entryId, date: payload.newDate, time: payload.finalTime, room: payload.finalRoom }
          : { ...e, id: String(e.id) },
      );
      if (!nextExtra.some((e) => String(e.id) === entryId)) {
        setRowEditSaveStatus("Could not find that extra lesson to update.");
        setSelectionError("Could not find that extra lesson to update.");
        return;
      }
      setExtraEntries(nextExtra);
      extraEntriesRef.current = nextExtra;
      window.localStorage.setItem(EXTRA_STORAGE_KEY, JSON.stringify(nextExtra));
      persistYearState({ extraEntries: nextExtra });
    } else {
      const entryId = String(payload.entryId ?? "");
      const nextList = rescheduleEntries.map((e) => {
        if (String(e.id) !== entryId) return { ...e, id: String(e.id) };
        return {
          ...e,
          id: entryId,
          toDate: payload.newDate,
          time: payload.finalTime,
          room: payload.finalRoom,
          pending: false,
        };
      });
      if (!nextList.some((e) => String(e.id) === entryId)) {
        setRowEditSaveStatus("Could not find that reschedule to update.");
        setSelectionError("Could not find that reschedule to update.");
        return;
      }
      setRescheduleEntries(nextList);
      rescheduleEntriesRef.current = nextList;
      window.localStorage.setItem(RESCHEDULE_STORAGE_KEY, JSON.stringify(nextList));
      persistYearState({ rescheduleEntries: nextList });
    }

    setRowEditConfirm(null);
    setRowEditSaveStatus("Saving…");
    setSelectionError("Saving…");
    void flushSaveLessonYearStateQueue()
      .then(() => {
        setRowEditSaveStatus("Saved.");
        setSelectionError("Saved.");
        window.setTimeout(() => {
          setRowEditSaveStatus("");
          setSelectionError((prev) => (prev === "Saved." ? "" : prev));
          closeRowEditPanel();
          setSelectedRowIds([]);
        }, 900);
      })
      .catch(() => {
        setRowEditSaveStatus("Save failed — try again.");
        setSelectionError("Cloud save failed. Your change may not have been stored.");
      });
  }

  function saveBulkEdit() {
    if (readOnly) return;
    setBulkEditSaveStatus("Saving...");
    setSelectionError("");

    if (bulkEditMode === "each") {
      let nextReschedule = [...rescheduleEntries];
      const nextOverrides = { ...overridesRef.current };

      for (let i = 0; i < bulkEditLessonDrafts.length; i++) {
        const draft = bulkEditLessonDrafts[i];
        const scheduleRow = scheduleRowById.get(draft.rowId);
        const lessonLabel = draft.original.date
          ? formatLessonDateLabel(draft.original.date, draft.original.weekday)
          : `Lesson ${i + 1}`;

        if (!scheduleRow || scheduleRow.rowKind !== "normal" || scheduleRow.extraEntryId) {
          setBulkEditSaveStatus(`Cannot find ${lessonLabel}.`);
          setSelectionError(`Cannot find ${lessonLabel}.`);
          return;
        }

        const finalTime = resolveBulkEditTime(draft);
        const finalRoom = pickerToStorage(draft.room.trim());
        if (!finalTime) {
          setBulkEditSaveStatus(`Please set a time for ${lessonLabel}.`);
          setSelectionError(`Please set a time for ${lessonLabel}.`);
          return;
        }
        if (!finalRoom) {
          setBulkEditSaveStatus(`Please set a room for ${lessonLabel}.`);
          setSelectionError(`Please set a room for ${lessonLabel}.`);
          return;
        }

        const originalDate = scheduleRow.date;
        const newDate = draft.date.trim();
        if (!newDate) {
          setBulkEditSaveStatus(`Please choose a date for ${lessonLabel}.`);
          setSelectionError(`Please choose a date for ${lessonLabel}.`);
          return;
        }
        if (newDate < yearMin || newDate > yearMax) {
          setBulkEditSaveStatus(`Date for ${lessonLabel} must be within ${targetYear}.`);
          setSelectionError(`Date for ${lessonLabel} must be within ${targetYear}.`);
          return;
        }

        const timeOrDateChanged =
          newDate !== originalDate || finalTime !== scheduleRow.baseTime;
        if (timeOrDateChanged) {
          if (!validationBaseRowByDate.has(originalDate)) {
            setBulkEditSaveStatus(`${lessonLabel}: original date is not a regular lesson.`);
            setSelectionError(`${lessonLabel}: original date must be an existing regular lesson date.`);
            return;
          }
          const fromSlot = fromSlotFieldsFromRow(scheduleRow);
          const fromSlotKey = originalLessonSlotKey(scheduleRow);
          const slotConflict = nextReschedule.some((e) => {
            if (e.fromDate !== originalDate) return false;
            if (!e.fromScheduleRuleId && !e.fromTime && !e.fromRoom) return true;
            return originalLessonSlotKey(e) === fromSlotKey;
          });
          if (slotConflict) {
            setBulkEditSaveStatus(`${lessonLabel} already has a reschedule. Edit it separately.`);
            setSelectionError(`${lessonLabel} already has a reschedule. Edit it separately.`);
            return;
          }
          const newId = `${Date.now()}-${i}`;
          nextReschedule = [
            ...nextReschedule,
            {
              id: newId,
              fromDate: originalDate,
              toDate: newDate,
              time: finalTime,
              room: finalRoom,
              ...fromSlot,
            },
          ];
          delete nextOverrides[originalDate];
        } else if (scheduleRoomsMatch(finalRoom, scheduleRow.baseRoom)) {
          delete nextOverrides[originalDate];
        } else {
          // Same day + same time, room-only tweak stays as regular override.
          nextOverrides[originalDate] = {
            ...(nextOverrides[originalDate] ?? {}),
            room: finalRoom,
          };
        }
      }

      setRescheduleEntries(nextReschedule);
      rescheduleEntriesRef.current = nextReschedule;
      window.localStorage.setItem(RESCHEDULE_STORAGE_KEY, JSON.stringify(nextReschedule));
      persistYearState({ rescheduleEntries: nextReschedule });
      persistOverrides(nextOverrides);

      setBulkEditSaveStatus("Saved.");
      setSelectionError("Saved.");
      window.setTimeout(() => {
        setBulkEditSaveStatus("");
        setSelectionError((prev) => (prev === "Saved." ? "" : prev));
        setShowBulkEditPanel(false);
        setBulkEditLessonDrafts([]);
        setSelectedRowIds([]);
      }, 1200);
      return;
    }

    const finalTime = resolveBulkEditTime(bulkEditForm);
    const finalRoom = pickerToStorage(bulkEditForm.room.trim());
    if (!finalTime) {
      setBulkEditSaveStatus("Please select or enter a lesson time.");
      setSelectionError("Please select or enter a lesson time.");
      return;
    }
    if (!finalRoom) {
      setBulkEditSaveStatus("Please select a room.");
      setSelectionError("Please select a room.");
      return;
    }

    if (bulkEditMode === "single") {
      const scheduleRow = selectedRowIds
        .map((id) => scheduleRowById.get(id))
        .find((r) => r?.rowKind === "normal" && !r.extraEntryId);
      if (!scheduleRow) {
        setBulkEditSaveStatus("Cannot find the selected lesson row.");
        setSelectionError("Cannot find the selected lesson row.");
        return;
      }

      const originalDate = scheduleRow.date;
      const newDate = bulkEditForm.date.trim();
      if (!newDate) {
        setBulkEditSaveStatus("Please choose a lesson date.");
        setSelectionError("Please choose a lesson date.");
        return;
      }
      if (newDate < yearMin || newDate > yearMax) {
        setBulkEditSaveStatus(`Date must be within ${targetYear}.`);
        setSelectionError(`Date must be within ${targetYear}.`);
        return;
      }

      const timeOrDateChanged =
        newDate !== originalDate || finalTime !== scheduleRow.baseTime;
      if (timeOrDateChanged) {
        if (!validationBaseRowByDate.has(originalDate)) {
          setBulkEditSaveStatus("Original date is not a regular lesson date.");
          setSelectionError("Original date must be an existing regular lesson date.");
          return;
        }
        const fromSlot = fromSlotFieldsFromRow(scheduleRow);
        const fromSlotKey = originalLessonSlotKey(scheduleRow);
        const slotConflict = rescheduleEntries.some((e) => {
          if (e.fromDate !== originalDate) return false;
          if (!e.fromScheduleRuleId && !e.fromTime && !e.fromRoom) return true;
          return originalLessonSlotKey(e) === fromSlotKey;
        });
        if (slotConflict) {
          setBulkEditSaveStatus("This lesson already has a reschedule. Use Reschedule to edit it.");
          setSelectionError("This lesson already has a reschedule. Use Reschedule to edit it.");
          return;
        }
        const nextList = [
          ...rescheduleEntries,
          {
            id: `${Date.now()}`,
            fromDate: originalDate,
            toDate: newDate,
            time: finalTime,
            room: finalRoom,
            ...fromSlot,
          },
        ];
        setRescheduleEntries(nextList);
        rescheduleEntriesRef.current = nextList;
        window.localStorage.setItem(RESCHEDULE_STORAGE_KEY, JSON.stringify(nextList));
        persistYearState({ rescheduleEntries: nextList });

        const nextOverrides = { ...overridesRef.current };
        delete nextOverrides[originalDate];
        persistOverrides(nextOverrides);
      } else {
        const nextOverrides = { ...overridesRef.current };
        if (scheduleRoomsMatch(finalRoom, scheduleRow.baseRoom)) {
          delete nextOverrides[originalDate];
        } else {
          // Same day + same time, room-only tweak stays as regular override.
          nextOverrides[originalDate] = {
            ...(nextOverrides[originalDate] ?? {}),
            room: finalRoom,
          };
        }
        persistOverrides(nextOverrides);
      }

      setBulkEditSaveStatus("Saved.");
      setSelectionError("Saved.");
      window.setTimeout(() => {
        setBulkEditSaveStatus("");
        setSelectionError((prev) => (prev === "Saved." ? "" : prev));
        setShowBulkEditPanel(false);
        setBulkEditLessonDrafts([]);
        setSelectedRowIds([]);
      }, 1200);
    }
  }

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

  const inactiveGapMarkers = useMemo(() => {
    if (!inactivePeriods.length) return [];
    const firstMonth = targetYear === LESSON_SYSTEM_START_YEAR ? LESSON_SYSTEM_START_MONTH : 1;
    return getInactiveMonthGapsInYearFromPeriods({
      periods: inactivePeriods.map((period) => ({
        studentId: period.student_id,
        startDate: period.start_date,
        endDate: period.end_date,
        note: period.note,
      })),
      studentId,
      grade: studentSummary.grade,
      year: targetYear,
      firstMonth,
    });
  }, [inactivePeriods, studentId, studentSummary.grade, targetYear]);

  const viewingInactiveMonthOnly = useMemo(() => {
    if (!filterMonth) return false;
    const m = Number(filterMonth);
    return inactiveGapMarkers.some((g) => g.months.includes(m));
  }, [filterMonth, inactiveGapMarkers]);

  const selectedInactiveMonthGap = useMemo(() => {
    if (!viewingInactiveMonthOnly || !filterMonth) return null;
    const m = Number(filterMonth);
    const gap = inactiveGapMarkers.find((g) => g.months.includes(m));
    if (!gap) return null;
    return { ...gap, months: [m] };
  }, [viewingInactiveMonthOnly, filterMonth, inactiveGapMarkers]);

  const lessonTableEntries = useMemo((): LessonTableEntry[] => {
    const rows = filteredScheduleRows;

    if (selectedInactiveMonthGap && !sortConfig) {
      const gapEntry: LessonTableEntry = {
        kind: "inactive-gap",
        gap: selectedInactiveMonthGap,
        key: `inactive-month-${selectedInactiveMonthGap.months[0]}`,
      };
      return [gapEntry, ...rows.map((row) => ({ kind: "row" as const, row }))];
    }

    const showGaps = !filterMonth && !sortConfig && inactiveGapMarkers.length > 0;
    if (!showGaps) return rows.map((row) => ({ kind: "row", row }));

    const entries: LessonTableEntry[] = [];
    const insertedGapKeys = new Set<string>();

    const tryInsertGaps = (nextMonth: number, prevMonth: number | null) => {
      for (const gap of inactiveGapMarkers) {
        const key = gap.months.join("-");
        if (insertedGapKeys.has(key)) continue;
        const gapEnd = gap.months[gap.months.length - 1]!;
        const shouldInsert =
          nextMonth > gapEnd &&
          ((prevMonth !== null && prevMonth === gap.afterMonth) || prevMonth === null);
        if (shouldInsert) {
          entries.push({ kind: "inactive-gap", gap, key: `inactive-${key}` });
          insertedGapKeys.add(key);
        }
      }
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const prevMonth = i > 0 ? rows[i - 1]!.month : null;
      tryInsertGaps(r.month, prevMonth);
      entries.push({ kind: "row", row: r });
    }
    return entries;
  }, [filteredScheduleRows, filterMonth, sortConfig, inactiveGapMarkers, selectedInactiveMonthGap]);

  function renderInactiveGapRow(gap: InactiveMonthGap, key: string) {
    const range = formatInactiveGapMonthRange(gap.months);
    return (
      <tr key={key} className="divide-x divide-slate-100 bg-slate-100">
        <td colSpan={11} className="px-4 py-4 text-center text-sm text-slate-700">
          <span className="mr-2 inline-flex items-center rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
            Status: Inactive
          </span>
          <span className="font-semibold text-slate-900">{range}</span>
          {" "}— 此段因 Inactive 不顯示課堂（{gap.effectiveDate} 起
          {gap.reactivateDate ? `，${gap.reactivateDate} 復課` : ""}）
        </td>
      </tr>
    );
  }

  const diagnosticMonth = filterMonth
    ? Number(filterMonth)
    : targetYear === LESSON_SYSTEM_START_YEAR
      ? LESSON_SYSTEM_START_MONTH
      : 1;

  const monthDiagnostic = useMemo(() => {
    if (!studentId) return { total: 0, visible: 0 };
    const monthRows = buildStudentScheduleRows(
      records,
      scheduleMapperState,
      targetYear,
      hkTodayYmd,
      { month: diagnosticMonth },
    );
    return {
      total: monthRows.length,
      visible: filteredScheduleRows.filter((r) => r.month === diagnosticMonth).length,
    };
  }, [
    records,
    studentId,
    scheduleMapperState,
    targetYear,
    hkTodayYmd,
    diagnosticMonth,
    filteredScheduleRows,
  ]);

  const activeDiagnosticVersionDate = useMemo(() => {
    if (records.length === 0) return null;
    const normalized = records.map((r) => ({
      effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
    }));
    const midMonthDay = `${targetYear}-${String(diagnosticMonth).padStart(2, "0")}-15`;
    return getActiveScheduleVersionDate(normalized, midMonthDay);
  }, [records, targetYear, diagnosticMonth]);

  const activeDiagnosticRuleCount = useMemo(() => {
    if (!activeDiagnosticVersionDate) return 0;
    return records.filter(
      (r) => (r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt)) === activeDiagnosticVersionDate,
    ).length;
  }, [records, activeDiagnosticVersionDate]);

  const diagnosticMonthLabel = MONTH_LABEL[diagnosticMonth] ?? String(diagnosticMonth);

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
    const row = validationBaseRowByDate.get(iso);
    setEditForm((prev) => {
      const effectiveTime = row?.time ?? "";
      const timePreset =
        row && opts.includes(effectiveTime)
          ? effectiveTime
          : opts.includes(prev.timePreset)
            ? prev.timePreset
            : opts[0];
      const room = row
        ? resolveScheduleRoomPickerValue(row.room, ROOM_GROUPS[0], registry)
        : resolveScheduleRoomPickerValue(prev.room, ROOM_GROUPS[0], registry);
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
    const row = selectedFromOriginalLesson;
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
      scheduleRuleId: row.scheduleRuleId,
      slotOptions: fromDateOriginalLessons,
    };
  }, [fromLessonDate, selectedFromOriginalLesson, overrides, fromDateOriginalLessons]);

  const LESSON_SUMMARY_SAVE_DEBOUNCE_MS = 600;

  function queueLessonSummarySave(dateIso: string) {
    if (isReadOnlyViewer) return;
    const existing = lessonSummarySaveTimersRef.current.get(dateIso);
    if (existing) window.clearTimeout(existing);

    const timer = window.setTimeout(() => {
      lessonSummarySaveTimersRef.current.delete(dateIso);
      if (!studentId) return;
      queueSaveLessonYearState(
        studentId,
        targetYear,
        {
          attendance: attendanceRef.current,
          hiddenDates: hiddenDatesRef.current,
          overrides: overridesRef.current,
          rescheduleEntries: rescheduleEntriesRef.current,
          extraEntries: extraEntriesRef.current,
        },
        ["overrides"],
      );
    }, LESSON_SUMMARY_SAVE_DEBOUNCE_MS);

    lessonSummarySaveTimersRef.current.set(dateIso, timer);
  }

  function handleLessonSummaryDraftChange(dateIso: string, nextText: string) {
    if (isReadOnlyViewer) return;
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

        {cloudSaveNotice ? (
          <div
            className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
              cloudSaveFailed
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-slate-200 bg-white text-slate-700 shadow-sm"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                {cloudSaveFailed ? (
                  <>
                    <span className="font-semibold">雲端儲存失敗：</span>
                    {cloudSaveNotice}
                  </>
                ) : (
                  cloudSaveNotice
                )}
              </p>
              {cloudSaveFailed ? (
                <button
                  type="button"
                  onClick={retryCloudSave}
                  className="shrink-0 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100"
                >
                  重試
                </button>
              ) : null}
            </div>
            {cloudSaveFailed ? (
              <p className="mt-1 text-xs text-red-700">
                畫面已更新，但可能未寫入資料庫；請重試後再離開此頁。
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <div className="flex items-center gap-3">
              <Link
                href={
                  isReadOnlyViewer && forceReadOnlyFromNext
                    ? String(searchParams.get("next") || "/rooms")
                    : `/students/${studentId}/lessons`
                }
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
            {isReadOnlyViewer ? (
              <p className="mt-2 inline-flex rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold text-white">
                Read-only mode
              </p>
            ) : null}
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
                  {showExamInfo ? (
                    <>
                      <div>
                        <p className="text-xs font-semibold tracking-wider text-slate-500">Latest Exam Date</p>
                        <p className="mt-1 text-sm font-bold text-slate-900">{visibleExamInfo.examDate || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold tracking-wider text-slate-500">Exam Content</p>
                        <p className="mt-1 text-sm font-bold text-slate-900 break-words">
                          {visibleExamInfo.examContent || "—"}
                        </p>
                      </div>
                    </>
                  ) : null}
                  <div>
                    <p className="text-xs font-semibold tracking-wider text-slate-500">Textbook publisher</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.textbookPublisher || "—"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 pb-28">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">{targetYear} Lesson Records</h2>
              <Link
                href={`/student-progress/${encodeURIComponent(studentId)}`}
                className="inline-flex items-center rounded-md bg-[#1d76c2] px-3 py-2 text-sm font-bold text-white transition hover:opacity-90"
              >
                Student Progress
              </Link>
            </div>
            {targetYear === LESSON_SYSTEM_START_YEAR ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                網站由 {LESSON_SYSTEM_START_LABEL_ZH} 起管理課表；{LESSON_SYSTEM_START_MONTH - 1}{" "}
                月及之前之 Excel 紀錄不會顯示於此。
              </p>
            ) : null}

            <fieldset
              disabled={readOnly}
              className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 disabled:opacity-95"
            >
              {visibilityMode === "inactive" && visibilityEffectiveDate ? (
                <p className="mb-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  此學生自 {visibilityEffectiveDate} 起為 Inactive
                  {visibilityReactivateDate ? `，預計 ${visibilityReactivateDate} 復課` : ""}
                  。Regular 課堂會隱藏；Extra / Reschedule 仍會顯示於此頁、Room 及 Daily Timetable。學費表繼續隱藏 inactive 月份。
                </p>
              ) : null}
              <ScheduleDuplicateRulesBanner
                records={records.map((r) => ({
                  ...r,
                  effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
                }))}
                weekdayLabel={(wd) => WEEKDAY_LABEL[wd] ?? wd}
                formatRoom={formatRoom}
                onMerged={(next) => {
                  const removed = records.length - next.length;
                  persistScheduleRecords(next as ScheduleRecord[]);
                  setSelectionError(
                    removed > 0
                      ? `已合併重複課表（刪除 ${removed} 條），並已寫入雲端。`
                      : "已合併重複課表並寫入雲端。",
                  );
                }}
              />
              {hiddenScheduleKeys.length > 0 ||
              records.length === 0 ||
              (records.length > 0 && monthDiagnostic.total === 0) ||
              (monthDiagnostic.visible === 0 && !viewingInactiveMonthOnly) ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  {hiddenScheduleKeys.length > 0 ? (
                    <>
                      <p className="font-semibold">
                        已隱藏 {hiddenScheduleKeys.length} 項（Delete 寫入 hidden_dates，唔係刪課表設定）
                      </p>
                      <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[11px]">
                        {hiddenScheduleKeys.map((key) => (
                          <li key={key} className="flex flex-wrap items-center justify-between gap-2">
                            <span>{formatHiddenScheduleKeyLabel(key)}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const next = { ...hiddenDates };
                                delete next[key];
                                persistHiddenDates(next);
                              }}
                              className="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold hover:bg-amber-100"
                            >
                              恢復
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm("Restore all hidden lessons for this student/year?")) return;
                          persistHiddenDates({});
                        }}
                        className="mt-2 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold hover:bg-amber-100"
                      >
                        全部恢復顯示
                      </button>
                    </>
                  ) : null}
                  {records.length === 0 ? (
                    <p className={`leading-snug${hiddenScheduleKeys.length > 0 ? " mt-2" : ""}`}>
                      課表設定（student_lesson_records）目前為<strong>空</strong>，所以{" "}
                      {diagnosticMonthLabel} 不會有任何 Regular 行。請到上一頁「Lesson Schedule Settings」重新加入星期／時間／房間。
                    </p>
                  ) : monthDiagnostic.total === 0 ? (
                    <p className={`leading-snug${hiddenScheduleKeys.length > 0 ? " mt-2" : ""}`}>
                      有 {records.length} 條課表規則，但 {diagnosticMonthLabel} 仍無課堂行。{diagnosticMonthLabel}{" "}
                      使用版本 effective date：
                      <strong> {activeDiagnosticVersionDate ?? "—"}</strong>（共 {activeDiagnosticRuleCount}{" "}
                      條）。若規則嘅<strong>星期</strong>同該月實際日期對唔上，或你曾在課表設定刪走該版本嘅規則，要重新 Add
                      Record。
                    </p>
                  ) : monthDiagnostic.visible === 0 ? (
                    <p className={`leading-snug${hiddenScheduleKeys.length > 0 ? " mt-2" : ""}`}>
                      {diagnosticMonthLabel} 共有 {monthDiagnostic.total} 堂，但被上方篩選（Month / Room / Tutor
                      等）濾走。請將 Month 改為 All 或 {diagnosticMonth}。
                    </p>
                  ) : null}
                  <Link
                    href={`/students/${studentId}/lessons`}
                    className="mt-2 inline-block font-semibold text-[#1d76c2] underline"
                  >
                    → 前往 Lesson Schedule Settings 檢查課表
                  </Link>
                </div>
              ) : null}
            </fieldset>

            <div ref={reschedulePanelRef} className="scroll-mt-4 scroll-mb-32">
            {showBulkEditPanel && (
              <div className="mt-4 rounded-xl border border-[#1d76c2]/30 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Reschedule</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {bulkEditMode === "single" ? (
                        <>
                          <strong className="font-semibold text-slate-800">One lesson</strong> — change date, time, or
                          room. Same date updates this lesson only; a new date moves the lesson (reschedule). Tutor /
                          summary: edit on the <strong className="font-semibold text-slate-800">room page</strong> (saved
                          per date).
                        </>
                      ) : (
                        <>
                          <strong className="font-semibold text-slate-800">{bulkEditLessonDrafts.length} lessons</strong> —
                          edit each one separately below (date, time, room). Same date updates that lesson only; a new
                          date moves it (reschedule). Tutor / summary:{" "}
                          <strong className="font-semibold text-slate-800">room page</strong>.
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBulkEditPanel(false);
                      setBulkEditSaveStatus("");
                      setBulkEditLessonDrafts([]);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path d="M5.22 5.22a.75.75 0 011.06 0L10 8.94l3.72-3.72a.75.75 0 111.06 1.06L11.06 10l3.72 3.72a.75.75 0 11-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 11-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 010-1.06z" />
                    </svg>
                    Close
                  </button>
                </div>

                {bulkEditMode === "each" ? (
                  <div className="mt-4 flex max-w-3xl flex-col gap-4">
                    {bulkEditLessonDrafts.map((draft, index) => (
                      <div
                        key={draft.rowId}
                        className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                      >
                        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-white px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Lesson {index + 1} of {bulkEditLessonDrafts.length}
                          </p>
                          <p className="mt-1 text-base font-semibold text-slate-900">
                            {formatLessonDateLabel(
                              draft.original.date ?? "",
                              draft.original.weekday,
                            )}
                            <span className="mx-2 font-normal text-slate-300">·</span>
                            {draft.original.displayTime}
                            <span className="mx-2 font-normal text-slate-300">·</span>
                            {formatRoom(draft.original.displayRoom)}
                          </p>
                        </div>
                        <div className="hidden border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid sm:grid-cols-[6.75rem_minmax(0,1fr)_auto_minmax(0,1.35fr)] sm:gap-3">
                          <span>Field</span>
                          <span>Was</span>
                          <span className="sr-only">To</span>
                          <span>Change to</span>
                        </div>
                        <BulkEditLessonFields
                          draft={draft}
                          yearMin={yearMin}
                          yearMax={yearMax}
                          formatRoom={formatRoom}
                          pickerLabel={pickerLabel}
                          onChange={(next) =>
                            setBulkEditLessonDrafts((prev) =>
                              prev.map((d, i) => (i === index ? next : d)),
                            )
                          }
                        />
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-end gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      {bulkEditSaveStatus ? (
                        <span className="text-xs font-semibold text-slate-600">{bulkEditSaveStatus}</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={saveBulkEdit}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#1d76c2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
                      >
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                          <path d="M3 4.5A1.5 1.5 0 014.5 3h8.44c.4 0 .78.16 1.06.44l2.06 2.06c.28.28.44.66.44 1.06V15.5A1.5 1.5 0 0115 17H4.5A1.5 1.5 0 013 15.5v-11zM5 5v3h7V5H5zm0 6.5A.5.5 0 015.5 11h9a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-4z" />
                        </svg>
                        Save all changes
                      </button>
                    </div>
                  </div>
                ) : (
                <div className="mt-4 max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {bulkEditForm.original.date ? (
                    <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-white px-4 py-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Current lesson
                      </p>
                      <p className="mt-1 text-base font-semibold text-slate-900">
                        {formatLessonDateLabel(
                          bulkEditForm.original.date,
                          bulkEditForm.original.weekday,
                        )}
                        <span className="mx-2 font-normal text-slate-300">·</span>
                        {bulkEditForm.original.displayTime}
                        <span className="mx-2 font-normal text-slate-300">·</span>
                        {formatRoom(bulkEditForm.original.displayRoom)}
                      </p>
                    </div>
                  ) : null}

                  <div className="hidden border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid sm:grid-cols-[6.75rem_minmax(0,1fr)_auto_minmax(0,1.35fr)] sm:gap-3">
                    <span>Field</span>
                    <span>Was</span>
                    <span className="sr-only">To</span>
                    <span>Change to</span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    <BulkEditCompareRow
                      label="Date"
                      before={formatLessonDateLabel(
                        bulkEditForm.original.date ?? "",
                        bulkEditForm.original.weekday,
                      )}
                      changed={bulkEditFieldChanged.date}
                    >
                      <input
                        type="date"
                        min={yearMin}
                        max={yearMax}
                        value={bulkEditForm.date}
                        onChange={(e) => {
                          const v = e.target.value;
                          const wd = v ? weekdayFromIsoDate(v) : "";
                          const { timePreset, timeCustom } = pickTimePreset(
                            bulkEditForm.timeCustom || bulkEditForm.timePreset,
                            wd,
                          );
                          setBulkEditForm((p) => ({
                            ...p,
                            date: v,
                            newWeekday: wd,
                            timePreset,
                            timeCustom,
                          }));
                        }}
                        className={bulkEditInputClass}
                      />
                    </BulkEditCompareRow>

                    <BulkEditCompareRow
                      label="Weekday"
                      before={
                        WEEKDAY_LABEL[bulkEditForm.original.weekday] ??
                        bulkEditForm.original.weekday
                      }
                      changed={bulkEditFieldChanged.weekday}
                    >
                      <input
                        type="text"
                        readOnly
                        disabled
                        value={bulkEditNewWeekdayDisplay}
                        className={bulkEditInputDisabledClass}
                      />
                    </BulkEditCompareRow>

                    <BulkEditCompareRow
                      label="Time"
                      before={bulkEditForm.original.displayTime}
                      beforeHint={
                        bulkEditForm.original.displayTime !== bulkEditForm.original.baseTime
                          ? `From schedule: ${bulkEditForm.original.baseTime}`
                          : undefined
                      }
                      changed={bulkEditFieldChanged.time}
                    >
                      <div className="space-y-2">
                        <select
                          value={bulkEditForm.timePreset}
                          onChange={(e) =>
                            setBulkEditForm((p) => ({ ...p, timePreset: e.target.value }))
                          }
                          className={bulkEditInputClass}
                        >
                          {bulkEditTimeOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={bulkEditForm.timeCustom}
                          onChange={(e) =>
                            setBulkEditForm((p) => ({ ...p, timeCustom: e.target.value }))
                          }
                          placeholder="Custom time (optional)"
                          className={bulkEditInputClass}
                        />
                      </div>
                    </BulkEditCompareRow>

                    <BulkEditCompareRow
                      label="Room"
                      before={
                        formatRoom(bulkEditForm.original.displayRoom)
                      }
                      beforeHint={
                        bulkEditForm.original.displayRoom !== bulkEditForm.original.baseRoom
                          ? `From schedule: ${formatRoom(bulkEditForm.original.baseRoom)}`
                          : undefined
                      }
                      changed={bulkEditFieldChanged.room}
                    >
                      <select
                        value={bulkEditForm.room}
                        onChange={(e) => setBulkEditForm((p) => ({ ...p, room: e.target.value }))}
                        className={bulkEditInputClass}
                      >
                        {ROOM_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {pickerLabel(option)}
                          </option>
                        ))}
                      </select>
                    </BulkEditCompareRow>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                    {bulkEditSaveStatus ? (
                      <span className="text-xs font-semibold text-slate-600">{bulkEditSaveStatus}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={saveBulkEdit}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#1d76c2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
                    >
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                        <path d="M3 4.5A1.5 1.5 0 014.5 3h8.44c.4 0 .78.16 1.06.44l2.06 2.06c.28.28.44.66.44 1.06V15.5A1.5 1.5 0 0115 17H4.5A1.5 1.5 0 013 15.5v-11zM5 5v3h7V5H5zm0 6.5A.5.5 0 015.5 11h9a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-4z" />
                      </svg>
                      Save changes
                    </button>
                  </div>
                </div>
                )}
              </div>
            )}

            {showRowEditPanel && rowEditSession ? (
              <div
                ref={rowEditPanelRef}
                className="mt-4 scroll-mt-4 scroll-mb-32 rounded-xl border border-slate-300 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Edit lesson</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Change Date, Day, Time, or Room. Save asks for confirmation before writing.
                      {rowEditSession.kind === "regular"
                        ? " Regular: date/time change becomes Cancelled + Reschedule; room-only stays as override."
                        : rowEditSession.kind === "extra"
                          ? " Extra: updates this extra lesson entry."
                          : " Reschedule: updates the makeup slot (original from-date stays)."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeRowEditPanel}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {rowEditSession.kind === "regular"
                        ? "Regular"
                        : rowEditSession.kind === "extra"
                          ? "Extra"
                          : "Reschedule"}
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {formatLessonDateLabel(
                        rowEditSession.draft.original.date ?? "",
                        rowEditSession.draft.original.weekday,
                      )}
                      <span className="mx-2 font-normal text-slate-300">·</span>
                      {rowEditSession.draft.original.displayTime}
                      <span className="mx-2 font-normal text-slate-300">·</span>
                      {formatRoom(rowEditSession.draft.original.displayRoom)}
                    </p>
                  </div>
                  <div className="hidden border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid sm:grid-cols-[6.75rem_minmax(0,1fr)_auto_minmax(0,1.35fr)] sm:gap-3">
                    <span>Field</span>
                    <span>Was</span>
                    <span className="sr-only">To</span>
                    <span>Change to</span>
                  </div>
                  <BulkEditLessonFields
                    draft={rowEditSession.draft}
                    yearMin={yearMin}
                    yearMax={yearMax}
                    formatRoom={formatRoom}
                    pickerLabel={pickerLabel}
                    onChange={(next) =>
                      setRowEditSession((prev) => (prev ? { ...prev, draft: next } : prev))
                    }
                  />
                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                    {rowEditSaveStatus ? (
                      <span className="text-xs font-semibold text-slate-600">{rowEditSaveStatus}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={requestRowEditConfirm}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#1d76c2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

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
                          {formatRoom(editOriginalLesson.baseRoom)}
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
                        {formatRoom(editOriginalLesson.displayRoom)}
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
                      onChange={(e) => {
                        setFromLessonDate(e.target.value);
                        setFromOriginalLessonKey("");
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    />
                    {lockFromLessonDate ? (
                      <p className="mt-1 text-[11px] text-slate-500">Filled from selected row; original date is locked.</p>
                    ) : null}
                  </label>

                  {fromDateOriginalLessons.length > 1 ? (
                    <label className="block">
                      <span className="mb-1 block text-sm font-semibold text-slate-700">
                        Original Lesson
                      </span>
                      <select
                        value={
                          fromOriginalLessonKey ||
                          (selectedFromOriginalLesson
                            ? originalLessonSlotKey(selectedFromOriginalLesson)
                            : "")
                        }
                        disabled={false}
                        onChange={(e) => setFromOriginalLessonKey(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                      >
                        {fromDateOriginalLessons.map((r) => {
                          const key = originalLessonSlotKey(r);
                          return (
                            <option key={key} value={key}>
                              {(WEEKDAY_LABEL[r.weekday] ?? r.weekday) +
                                ` ${r.time} · ${formatRoom(r.room)}`}
                            </option>
                          );
                        })}
                      </select>
                      <p className="mt-1 text-[11px] text-slate-500">
                        This date has {fromDateOriginalLessons.length} regular lessons — pick which
                        one to cancel / move.
                      </p>
                    </label>
                  ) : null}

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
                            const editingEntry = editingRescheduleId
                              ? rescheduleEntries.find((e) => e.id === editingRescheduleId)
                              : undefined;
                            // Locked pending makeup cannot stay pending, but admins can still
                            // convert it into a concrete reschedule (including same-day) to fix mistakes.
                            if (
                              editingEntry &&
                              isPendingRescheduleEntry(editingEntry) &&
                              !isPendingMakeupEditable(from, hkTodayYmd) &&
                              !to
                            ) {
                              const msg = pendingMakeupLockedMessage(from);
                              setEditSaveStatus(msg);
                              setSelectionError(msg);
                              return;
                            }
                            if (!validationBaseRowByDate.has(from)) {
                              setEditSaveStatus("Original date is not a regular lesson date.");
                              setSelectionError("Original date must be an existing regular lesson date.");
                              return;
                            }
                            const fromSlotRow =
                              selectedFromOriginalLesson ??
                              fromDateOriginalLessons[0] ??
                              validationBaseRowByDate.get(from) ??
                              null;
                            if (!fromSlotRow) {
                              setEditSaveStatus("Original date is not a regular lesson date.");
                              setSelectionError("Original date must be an existing regular lesson date.");
                              return;
                            }
                            const fromSlot = fromSlotFieldsFromRow(fromSlotRow);
                            const fromSlotKey = originalLessonSlotKey(fromSlotRow);
                            const ids = rescheduleIdsByFromDate.get(from) ?? [];
                            const slotConflict = rescheduleEntries.some((e) => {
                              if (e.id === editingRescheduleId) return false;
                              if (e.fromDate !== from) return false;
                              if (!e.fromScheduleRuleId && !e.fromTime && !e.fromRoom) return true;
                              return originalLessonSlotKey(e) === fromSlotKey;
                            });
                            if (slotConflict || ids.some((id) => {
                              if (id === editingRescheduleId) return false;
                              const e = rescheduleEntryById.get(id);
                              if (!e) return false;
                              if (!e.fromScheduleRuleId && !e.fromTime && !e.fromRoom) return true;
                              return originalLessonSlotKey(e) === fromSlotKey;
                            })) {
                              setEditSaveStatus("This original lesson already has a reschedule record.");
                              setSelectionError("This original lesson already has a reschedule record.");
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
                            const finalRoom = pickerToStorage(editForm.room.trim());
                            // Same-day time/room changes are still reschedule (Cancelled + Reschedule),
                            // not a regular override.
                            const nextList = editingRescheduleId
                              ? rescheduleEntries.map((e) =>
                                  e.id === editingRescheduleId
                                    ? {
                                        ...e,
                                        fromDate: from,
                                        toDate: to,
                                        time: finalTime,
                                        room: finalRoom,
                                        pending: false,
                                        ...fromSlot,
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
                                    room: finalRoom,
                                    ...fromSlot,
                                  },
                                ];
                            setRescheduleEntries(nextList);
                            rescheduleEntriesRef.current = nextList;
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
                                  room: pickerToStorage(editForm.room.trim()),
                                },
                              ];
                              setExtraEntries(nextExtraEntries);
                              extraEntriesRef.current = nextExtraEntries;
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
                            {pickerLabel(option)}
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
                            if (!isPendingMakeupEditable(from, hkTodayYmd)) {
                              const msg = pendingMakeupLockedMessage(from);
                              setEditSaveStatus(msg);
                              setSelectionError(msg);
                              return;
                            }
                            if (!validationBaseRowByDate.has(from)) {
                              setEditSaveStatus("Original date is not a regular lesson date.");
                              setSelectionError("Original date must be an existing regular lesson date.");
                              return;
                            }
                            const fromSlotRow =
                              selectedFromOriginalLesson ??
                              fromDateOriginalLessons[0] ??
                              validationBaseRowByDate.get(from) ??
                              null;
                            if (!fromSlotRow) {
                              setEditSaveStatus("Original date is not a regular lesson date.");
                              setSelectionError("Original date must be an existing regular lesson date.");
                              return;
                            }
                            const fromSlot = fromSlotFieldsFromRow(fromSlotRow);
                            const fromSlotKey = originalLessonSlotKey(fromSlotRow);
                            const slotConflict = rescheduleEntries.some((e) => {
                              if (e.fromDate !== from) return false;
                              if (!e.fromScheduleRuleId && !e.fromTime && !e.fromRoom) return true;
                              return originalLessonSlotKey(e) === fromSlotKey;
                            });
                            if (slotConflict) {
                              setEditSaveStatus("This original lesson already has a reschedule record.");
                              setSelectionError("This original lesson already has a reschedule record.");
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
                                ...fromSlot,
                              },
                            ];
                            setRescheduleEntries(nextList);
                            rescheduleEntriesRef.current = nextList;
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
            </div>

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
                                room: pickerToStorage(extraForm.room.trim()),
                              },
                            ];
                            if (extraForm.doubleEnabled) {
                              nextExtra.push({
                                id: `${Date.now()}-2`,
                                date,
                                time: finalTime,
                                room: pickerToStorage(extraForm.room2.trim() || extraForm.room.trim()),
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
                    <span className="mb-1 block text-sm font-semibold text-slate-700">
                      {extraForm.doubleEnabled ? "Room 1" : "Room"}
                    </span>
                    <div className="flex items-center gap-3">
                      <select
                        value={extraForm.room}
                        onChange={(e) => setExtraForm((p) => ({ ...p, room: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                      >
                        {ROOM_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {pickerLabel(option)}
                          </option>
                        ))}
                      </select>
                      <label className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={extraForm.doubleEnabled}
                          onChange={(e) =>
                            setExtraForm((p) => ({
                              ...p,
                              doubleEnabled: e.target.checked,
                              room2: e.target.checked ? p.room2 || p.room : p.room2,
                            }))
                          }
                          className="h-5 w-5 accent-[#1d76c2]"
                        />
                        Double Lesson
                      </label>
                    </div>
                  </div>
                  {extraForm.doubleEnabled ? (
                    <>
                      <div className="block">
                        <span className="mb-1 block text-sm font-semibold text-slate-700">Room 2</span>
                        <select
                          value={extraForm.room2}
                          onChange={(e) => setExtraForm((p) => ({ ...p, room2: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                        >
                          {ROOM_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {pickerLabel(option)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 lg:col-span-5">
                        Double Lesson: same day and time; Room 1 and Room 2 can differ (e.g. different tutors).
                      </div>
                    </>
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
                    onChange={(e) => {
                      const v = e.target.value;
                      setFilterMonth(v);
                      // Inactive gap rows are only inserted when no sorting is applied.
                      // When user picks Month=All, reset sort so they can always see Status: Inactive.
                      if (!v) setSortConfig(null);
                    }}
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
                        {formatRoom(room)}
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

            <fieldset disabled={readOnly} className="mt-4 disabled:opacity-95">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
                    ) : lessonTableEntries.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-500">
                          {viewingInactiveMonthOnly && selectedInactiveMonthGap ? (
                            <>
                              {formatInactiveGapMonthRange(selectedInactiveMonthGap.months)} — 此段因 Inactive
                              不顯示課堂（{selectedInactiveMonthGap.effectiveDate} 起
                              {selectedInactiveMonthGap.reactivateDate
                                ? `，${selectedInactiveMonthGap.reactivateDate} 復課`
                                : ""}
                              ）
                            </>
                          ) : (
                            "No records match current filters."
                          )}
                        </td>
                      </tr>
                    ) : (
                      lessonTableEntries.map((entry, idx) => {
                        if (entry.kind === "inactive-gap") {
                          return renderInactiveGapRow(entry.gap, entry.key);
                        }

                        const r = entry.row;
                        const nextRowEntry = lessonTableEntries.slice(idx + 1).find((e) => e.kind === "row");
                        const nextMonth = nextRowEntry?.kind === "row" ? nextRowEntry.row.month : null;

                        return (
                        <tr
                          key={r.rowId}
                          className={[
                            "divide-x divide-slate-100",
                            nextMonth !== null && nextMonth !== r.month
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
                                {r.rowKind === "normal" && r.scheduleRuleId
                                  ? isRegularLessonAttended(attendance, { id: r.scheduleRuleId }, r.date)
                                    ? "✓"
                                    : ""
                                  : attendance[r.attendanceKey]
                                    ? "✓"
                                    : ""}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {r.lessonType === TYPE_RESCHEDULE && r.rescheduleFromDate ? (
                              <RescheduleChangeCell
                                before={r.rescheduleFromDate}
                                after={r.date}
                              />
                            ) : (
                              r.date
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-sm text-slate-700">
                            {r.lessonType === TYPE_RESCHEDULE && r.rescheduleFromDate ? (
                              <RescheduleChangeCell
                                before={
                                  WEEKDAY_LABEL[weekdayFromIsoDate(r.rescheduleFromDate)] ??
                                  weekdayFromIsoDate(r.rescheduleFromDate)
                                }
                                after={WEEKDAY_LABEL[r.weekday] ?? r.weekday}
                              />
                            ) : (
                              WEEKDAY_LABEL[r.weekday] ?? r.weekday
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {r.lessonType === TYPE_RESCHEDULE && r.rescheduleFromDate ? (
                              <RescheduleChangeCell before={r.baseTime} after={r.time} />
                            ) : (
                              r.time
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-sm text-slate-700">
                            {r.lessonType === TYPE_RESCHEDULE && r.rescheduleFromDate ? (
                              <RescheduleChangeCell
                                before={r.baseRoom}
                                after={r.room}
                                format={(v) => formatRoom(v)}
                              />
                            ) : r.baseRoom &&
                              !scheduleRoomsMatch(r.baseRoom, r.room) ? (
                              <RescheduleChangeCell
                                before={r.baseRoom}
                                after={r.room}
                                format={(v) => formatRoom(v)}
                              />
                            ) : (
                              formatRoom(r.room)
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {displayTutorInCell(r.tutor)}
                          </td>
                          <td className="w-[20%] min-w-[220px] px-4 py-3 text-sm text-slate-700 align-top break-words whitespace-normal">
                            <textarea
                              rows={3}
                              suppressHydrationWarning
                              readOnly={readOnly}
                              disabled={readOnly}
                              value={
                                lessonSummaryDraftByDateIso[r.date] ?? r.lessonSummary ?? ""
                              }
                              onChange={(e) =>
                                handleLessonSummaryDraftChange(r.date, e.target.value)
                              }
                              aria-label={`${r.date} Lesson Summary`}
                              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-50"
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
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            </fieldset>
          </div>
        </div>

        <div
          className={`fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 shadow-[0_-8px_30px_rgba(15,23,42,0.1)] backdrop-blur-md${readOnly ? " pointer-events-none opacity-60" : ""}`}
          role="toolbar"
          aria-label="Lesson selection actions"
        >
          <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-5 lg:px-6">
            <p className="text-sm text-slate-700">
              Selected: <span className="font-bold text-slate-900">{selectedRowIds.length}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={readOnly}
                onClick={openRescheduleFromSelection}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                  <path d="M4.5 5.75a.75.75 0 010-1.5h9.69l-2.22-2.22a.75.75 0 111.06-1.06l3.5 3.5a.75.75 0 010 1.06l-3.5 3.5a.75.75 0 01-1.06-1.06l2.22-2.22H4.5zm11 8.5a.75.75 0 010 1.5H5.81l2.22 2.22a.75.75 0 11-1.06 1.06l-3.5-3.5a.75.75 0 010-1.06l3.5-3.5a.75.75 0 011.06 1.06l-2.22 2.22H15.5z" />
                </svg>
                Reschedule
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  if (selectedRowIds.length > 1) {
                    setSelectionError("For pending leave, select only 1 regular lesson row.");
                    return;
                  }
                  setShowBulkEditPanel(false);
                  setShowExtraPanel(false);
                  setShowRowEditPanel(false);
                  setRowEditSession(null);
                  setRowEditConfirm(null);
                  setReschedulePanelMode("pending");
                  setSelectionError("");
                  setEditingRescheduleId(null);
                  if (selectedRowIds.length === 1) {
                    const row = scheduleRowById.get(selectedRowIds[0]);
                    if (!row || row.rowKind !== "normal") {
                      setSelectionError("Select a regular lesson row to mark leave / pending makeup.");
                      return;
                    }
                    if (!isPendingMakeupEditable(row.date, hkTodayYmd)) {
                      setSelectionError(pendingMakeupLockedMessage(row.date));
                      return;
                    }
                    setFromLessonDate(row.date);
                    setFromOriginalLessonKey(originalLessonSlotKey(row));
                    setToLessonDate("");
                    setLockFromLessonDate(true);
                  } else {
                    setFromLessonDate("");
                    setFromOriginalLessonKey("");
                    setToLessonDate("");
                    setLockFromLessonDate(false);
                  }
                  setShowEditPanel(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {PENDING_MAKEUP_BUTTON_LABEL}
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  setSelectionError("");
                  if (selectedRowIds.length > 1) {
                    setSelectionError(
                      "For extra lesson, select only 1 row for prefill, or clear selection and fill manually.",
                    );
                    return;
                  }
                  setShowBulkEditPanel(false);
                  setShowEditPanel(false);
                  setShowRowEditPanel(false);
                  setRowEditSession(null);
                  setRowEditConfirm(null);
                  if (selectedRowIds.length === 1) {
                    const row = scheduleRowById.get(selectedRowIds[0]);
                    if (!row) {
                      setSelectionError("Cannot find row for prefill.");
                      return;
                    }
                    const wd = weekdayFromIsoDate(row.date);
                    const opts = wd === "六" ? SATURDAY_TIME_SUGGESTIONS : WEEKDAY_TIME_SUGGESTIONS;
                    const room = resolveScheduleRoomPickerValue(row.room);
                    setExtraForm({
                      date: row.date,
                      timePreset: opts.includes(row.time) ? row.time : opts[0],
                      timeCustom: opts.includes(row.time) ? "" : row.time,
                      room,
                      room2: room,
                      doubleEnabled: false,
                    });
                  } else {
                    setExtraForm({
                      date: toHkIsoDateFromMs(Date.now()),
                      timePreset: WEEKDAY_TIME_SUGGESTIONS[0],
                      timeCustom: "",
                      room: ROOM_OPTIONS[0],
                      room2: ROOM_OPTIONS[0],
                      doubleEnabled: false,
                    });
                  }
                  setShowExtraPanel(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                  <path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" />
                </svg>
                Extra Lesson
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={openRowEditFromSelection}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                  <path d="M14.69 2.86a2 2 0 112.83 2.83l-8.4 8.4a1 1 0 01-.46.26l-3.32.83a.75.75 0 01-.9-.9l.83-3.32a1 1 0 01.26-.46l8.4-8.4zM4.75 16.25a.75.75 0 100 1.5h10.5a.75.75 0 000-1.5H4.75z" />
                </svg>
                Edit
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  if (selectedRowIds.length === 0) {
                    setSelectionError("Please select rows to delete first.");
                    return;
                  }
                  setSelectionError("");
                  const selectedRows = selectedRowIds
                    .map((id) => scheduleRowById.get(id))
                    .filter((r): r is ScheduleRow => Boolean(r));

                  const regularDeletes = selectedRows.filter(
                    (row) => row.rowKind === "normal" && !row.extraEntryId,
                  );
                  const willHideWholeDates = new Set<string>();
                  const willHideRuleDates = new Set<string>();
                  for (const row of regularDeletes) {
                    const parsed = parseRegularLessonRowId(row.rowId);
                    if (!parsed) {
                      willHideWholeDates.add(row.date);
                      continue;
                    }
                    willHideRuleDates.add(`${parsed.dateIso} · rule ${parsed.ruleId}`);
                  }
                  const confirmLines = [
                    "Hide selected lesson row(s) from this list?",
                    willHideWholeDates.size > 0
                      ? `• Whole dates (all lessons that day): ${[...willHideWholeDates].join(", ")}`
                      : "",
                    willHideRuleDates.size > 0
                      ? `• Selected date only: ${[...willHideRuleDates].join(", ")}`
                      : "",
                  ].filter(Boolean);
                  if (!window.confirm(confirmLines.join("\n"))) return;

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
                    for (const id of rescheduleIdsToDelete) {
                      const entry = rescheduleEntryById.get(id);
                      if (
                        entry &&
                        isPendingRescheduleEntry(entry) &&
                        !isPendingMakeupEditable(entry.fromDate, hkTodayYmd)
                      ) {
                        setSelectionError(pendingMakeupLockedMessage(entry.fromDate));
                        return;
                      }
                    }
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
                    window.localStorage.setItem(EXTRA_STORAGE_KEY, JSON.stringify(nextExtraEntries));
                    persistYearState({ extraEntries: nextExtraEntries });
                  }

                  const nextHidden = { ...hiddenDates };
                  for (const row of selectedRows) {
                    if (row.rowKind !== "normal" || row.extraEntryId) continue;
                    const parsed = parseRegularLessonRowId(row.rowId);
                    if (!parsed) {
                      nextHidden[row.date] = true;
                      continue;
                    }
                    nextHidden[hiddenScheduleRuleDateStorageKey(parsed.ruleId, parsed.dateIso)] = true;
                  }
                  persistHiddenDates(nextHidden);
                  setSelectedRowIds([]);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                  <path d="M7.5 2.75A1.75 1.75 0 005.75 4.5v.25H4a.75.75 0 000 1.5h.5l.73 9.1A2 2 0 007.22 17.2h5.56a2 2 0 001.99-1.85l.73-9.1H16a.75.75 0 000-1.5h-1.75V4.5A1.75 1.75 0 0012.5 2.75h-5zM12.75 4.5v.25h-5.5V4.5a.25.25 0 01.25-.25h5a.25.25 0 01.25.25z" />
                </svg>
                Delete
              </button>
            </div>
          </div>
          {selectionError ? (
            <div className="mx-auto max-w-[1500px] px-3 pb-2.5 sm:px-5 lg:px-6">
              <p className="text-xs font-medium text-red-600">{selectionError}</p>
            </div>
          ) : null}
        </div>
      </div>

      {rowEditConfirm ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="row-edit-confirm-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 id="row-edit-confirm-title" className="text-base font-bold text-slate-900">
              Confirm save?
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Review the change below. Nothing is written until you confirm.
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              {(
                [
                  ["Date", "date"],
                  ["Day", "weekday"],
                  ["Time", "time"],
                  ["Room", "room"],
                ] as const
              ).map(([label, key]) => {
                const beforeRaw = rowEditConfirm.before[key];
                const afterRaw = rowEditConfirm.after[key];
                const before =
                  key === "weekday"
                    ? WEEKDAY_LABEL[beforeRaw] ?? beforeRaw
                    : key === "room"
                      ? formatRoom(beforeRaw)
                      : key === "date"
                        ? formatLessonDateLabel(beforeRaw, rowEditConfirm.before.weekday)
                        : beforeRaw;
                const after =
                  key === "weekday"
                    ? WEEKDAY_LABEL[afterRaw] ?? afterRaw
                    : key === "room"
                      ? formatRoom(afterRaw)
                      : key === "date"
                        ? formatLessonDateLabel(afterRaw, rowEditConfirm.after.weekday)
                        : afterRaw;
                const changed = before !== after;
                return (
                  <div key={key} className="grid grid-cols-[4.5rem_1fr] gap-2">
                    <dt className="font-semibold text-slate-600">{label}</dt>
                    <dd className="min-w-0">
                      {changed ? (
                        <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 line-through">
                            {before || "—"}
                          </span>
                          <span className="text-slate-400" aria-hidden>
                            →
                          </span>
                          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-xs font-semibold text-[#1d76c2]">
                            {after || "—"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-800">{after || "—"}</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setRowEditConfirm(null)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={confirmRowEditSave}
                className="rounded-md bg-[#1d76c2] px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Confirm save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
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
