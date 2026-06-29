/**
 * Maps yearScheduleCore rows to the student year-lesson page UI shape.
 * Keeps L-label / double-reschedule display logic in one place.
 */

import { readLessonDayOverrideField } from "@/lib/lessonScheduleVersions";
import {
  formatPendingMakeupReminder,
  PENDING_MAKEUP_TYPE_LABEL,
} from "@/lib/pendingMakeup";
import {
  buildYearScheduleRows,
  type BuiltScheduleRow,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";

const TYPE_REGULAR = "Regular";
const TYPE_CANCELLED = "Cancelled";
const TYPE_RESCHEDULE = "Reschedule";
const TYPE_PENDING = PENDING_MAKEUP_TYPE_LABEL;
const TYPE_EXTRA = "Extra";

export type StudentLessonScheduleRow = {
  month: number;
  lLabel: string;
  date: string;
  weekday: string;
  baseTime: string;
  baseRoom: string;
  rescheduleFromDate?: string;
  time: string;
  room: string;
  tutor: string;
  lessonSummary: string;
  lessonType: string;
  rowKind: "normal" | "cancelled_original" | "reschedule";
  rowId: string;
  attendanceKey: string;
  displayOrder: number;
  rescheduleEntryId?: string;
  extraEntryId?: string;
  pendingMakeupLabel?: string;
};

export type StudentScheduleMapperState = Pick<
  YearLessonState,
  "hiddenDates" | "overrides" | "rescheduleEntries" | "extraEntries"
>;

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

function getHkWeekdayNumber(d: Date) {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function weekdayFromIsoDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mm - 1, d);
  return numberToWeekday(getHkWeekdayNumber(dt));
}

function monthFromIso(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Number(m[2]) : 1;
}

function isDoubleReschedulePairId(id: unknown): boolean {
  return String(id ?? "").endsWith("-double-reschedule");
}

function coreLessonTypeToUi(lessonType: BuiltScheduleRow["lessonType"]): string {
  switch (lessonType) {
    case "恆常":
      return TYPE_REGULAR;
    case "取消":
      return TYPE_CANCELLED;
    case "補堂":
      return TYPE_RESCHEDULE;
    case "加堂":
      return TYPE_EXTRA;
    default:
      return TYPE_PENDING;
  }
}

function ruleRecordById(records: YearLessonRecord[], ruleId: string | undefined) {
  if (!ruleId) return null;
  return records.find((r) => r.id === ruleId) ?? null;
}

function mapCoreRowToStudentRow(
  core: BuiltScheduleRow,
  records: YearLessonRecord[],
  state: StudentScheduleMapperState,
  hkTodayYmd: string,
): Omit<StudentLessonScheduleRow, "month" | "lLabel" | "weekday" | "displayOrder"> {
  const rule = ruleRecordById(records, core.scheduleRuleId);
  let baseTime = rule?.time.toString() ?? core.time;
  let baseRoom = rule?.room.toString() ?? core.room;

  let rescheduleFromDate: string | undefined;
  let rescheduleEntryId: string | undefined;
  let extraEntryId: string | undefined;
  let pendingMakeupLabel: string | undefined;

  if (core.rowKind === "reschedule") {
    rescheduleEntryId = core.rowId.slice("reschedule-".length);
    const entry = state.rescheduleEntries.find((e) => e.id === rescheduleEntryId);
    rescheduleFromDate = entry?.fromDate;
    if (!rule && entry) {
      baseTime = entry.time;
      baseRoom = entry.room;
    }
  }

  if (core.rowKind === "cancelled_original") {
    const cancelledMatch = /^cancelled-(.+)-(\d{4}-\d{2}-\d{2})$/.exec(core.rowId);
    if (cancelledMatch) {
      rescheduleEntryId = cancelledMatch[1];
      const entry = state.rescheduleEntries.find((e) => e.id === rescheduleEntryId);
      if (entry?.pending) {
        pendingMakeupLabel = formatPendingMakeupReminder(entry.fromDate, hkTodayYmd);
      }
    }
  }

  if (core.lessonType === "加堂") {
    extraEntryId = core.rowId.slice("extra-".length);
  }

  let tutor = core.tutorDisplay;
  let lessonSummary = core.noteDisplay;
  if (core.rowKind === "reschedule") {
    tutor = readLessonDayOverrideField(state.overrides, core.date, "tutor") || tutor;
    lessonSummary =
      readLessonDayOverrideField(state.overrides, core.date, "lessonSummary") || lessonSummary;
  }

  return {
    date: core.date,
    baseTime,
    baseRoom,
    rescheduleFromDate,
    time: core.time,
    room: core.room,
    tutor: tutor.toString(),
    lessonSummary: lessonSummary.toString(),
    lessonType: coreLessonTypeToUi(core.lessonType),
    rowKind: core.rowKind,
    rowId: core.rowId,
    attendanceKey: core.attendanceKey,
    rescheduleEntryId,
    extraEntryId,
    pendingMakeupLabel,
  };
}

function assignLLabelsAndDisplayOrder(
  rows: StudentLessonScheduleRow[],
): StudentLessonScheduleRow[] {
  const autoDoubleKeys = new Set<string>();
  for (const r of rows) {
    if (r.extraEntryId && isDoubleReschedulePairId(r.extraEntryId)) {
      autoDoubleKeys.add(`${r.date}|${r.time}|${r.room}`);
    }
  }

  const monthCounter: Record<number, number> = {};
  return rows.map((r, i) => {
    if (r.rowKind === "cancelled_original") {
      return { ...r, lLabel: "/", displayOrder: i };
    }
    const rowKey = `${r.date}|${r.time}|${r.room}`;
    if (r.extraEntryId && isDoubleReschedulePairId(r.extraEntryId)) {
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
}

function toYearLessonState(state: StudentScheduleMapperState): YearLessonState {
  return {
    attendance: {},
    hiddenDates: state.hiddenDates,
    overrides: state.overrides,
    rescheduleEntries: state.rescheduleEntries,
    extraEntries: state.extraEntries,
  };
}

function coreRowsToStudentRows(
  coreRows: BuiltScheduleRow[],
  records: YearLessonRecord[],
  state: StudentScheduleMapperState,
  hkTodayYmd: string,
): StudentLessonScheduleRow[] {
  const rows = coreRows.map((core) => {
    const partial = mapCoreRowToStudentRow(core, records, state, hkTodayYmd);
    return {
      ...partial,
      month: monthFromIso(core.date),
      weekday: weekdayFromIsoDate(core.date),
      lLabel: "L0",
      displayOrder: 0,
    };
  });
  return assignLLabelsAndDisplayOrder(rows);
}

export type StudentScheduleBuildOptions = {
  month?: number;
  rangeStartIso?: string;
  rangeEndIso?: string;
};

export function buildStudentBaseScheduleRows(
  records: YearLessonRecord[],
  state: StudentScheduleMapperState,
  targetYear: number,
  hkTodayYmd: string,
  buildOptions?: StudentScheduleBuildOptions,
): StudentLessonScheduleRow[] {
  const emptyRescheduleState: StudentScheduleMapperState = {
    hiddenDates: state.hiddenDates,
    overrides: state.overrides,
    rescheduleEntries: [],
    extraEntries: [],
  };
  const coreRows = buildYearScheduleRows(
    records,
    toYearLessonState(emptyRescheduleState),
    targetYear,
    buildOptions,
  ).filter((r) => r.lessonType === "恆常");

  const monthCounter: Record<number, number> = {};
  return coreRows.map((core) => {
    const month = monthFromIso(core.date);
    monthCounter[month] = (monthCounter[month] ?? 0) + 1;
    const partial = mapCoreRowToStudentRow(core, records, emptyRescheduleState, hkTodayYmd);
    return {
      ...partial,
      month,
      weekday: weekdayFromIsoDate(core.date),
      lLabel: `L${monthCounter[month]}`,
      displayOrder: 0,
      lessonType: TYPE_REGULAR,
      rowKind: "normal" as const,
    };
  });
}

export function buildStudentScheduleRows(
  records: YearLessonRecord[],
  state: StudentScheduleMapperState,
  targetYear: number,
  hkTodayYmd: string,
  buildOptions?: StudentScheduleBuildOptions,
): StudentLessonScheduleRow[] {
  const coreRows = buildYearScheduleRows(
    records,
    toYearLessonState(state),
    targetYear,
    buildOptions,
  );
  return coreRowsToStudentRows(coreRows, records, state, hkTodayYmd);
}
