import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { unstable_cache } from "next/cache";
import { SCHEDULE_CACHE_TAG_DAY_TIMETABLE } from "@/lib/scheduleCacheTags";
import {
  PENDING_MAKEUP_TYPE_LABEL,
} from "@/lib/pendingMakeup";
import {
  getActiveScheduleRulesForDate,
} from "@/lib/lessonScheduleVersions";
import { buildDayTimetableRowsForDate, studentHasMakeupOrExtraOnDate } from "@/lib/dayTimetableScheduleRows";
import {
  LESSON_TYPE_DISPLAY_PRIORITY,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";
import { readYmdParts } from "@/lib/intlFormatParts";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { filterActiveStudentsOnDate } from "@/lib/activeStudentIds";
import {
  getStudentGradeForDate,
  type GradeHistoryByStudentId,
} from "@/lib/studentGradeHistory";
import {
  buildStudentInactivePeriodsById,
  isStudentInactiveOnDateFromPeriods,
  isTemporarilyInactiveOnDateFromPeriods,
  withAutoF6InactivePeriod,
  type StudentInactivePeriod,
} from "@/lib/studentVisibility";
import { loadRoomSlotTutorRulesServer } from "@/lib/roomSlotTutorRules";
import type { RoomSlotTutorRule } from "@/lib/roomSlotTutorRules";
import {
  loadLessonScheduleRecordsBatchServer,
  loadLessonYearStatesBatchServer,
} from "@/lib/lessonDataServer";
import { loadYearScheduleData, normalizeLessonRecords } from "@/lib/yearScheduleData.server";
import { TUTOR_STATUS_INACTIVE } from "@/lib/tutorConstants";
import type { DayTimetableFeePaymentTone } from "@/lib/dayTimetableStyleSettings";
import { loadDayTimetableStyleSettings } from "@/lib/dayTimetableStyleSettings.server";
import {
  ROOM_GROUPS,
  hkTodayYmd,
  parseDayParams,
  toDayIso,
  weekdayCnFromIsoDateHk,
  type DayTimetableCell,
  type DayTimetablePayload,
  type DayTimetableRowFrame,
  type RoomGroup,
} from "@/lib/dayTimetableShared";
import { normalizeStudentId } from "@/lib/studentId";
import {
  gradeForFeePricing,
  sumSlotTuitionHkdByLessonCount,
} from "@/lib/studentFeePricingGrade";
import {
  loadStudentFeeTierSettingsAdmin,
  resolveFeeTierSettingsForStudent,
  type StudentFeeTierBundle,
} from "@/lib/studentFeeTierSettings";
import {
  buildRoomDisplayRegistry,
  listScheduleRoomGroups,
  resolveRoomGroupFromRegistry,
  SLUG_TO_ROOM_GROUP,
  type RoomDisplayRegistry,
} from "@/lib/roomDisplayRegistry";

export {
  ROOM_GROUPS,
  hkTodayYmd,
  parseDayParams,
  toDayIso,
  weekdayCnFromIsoDateHk,
  type DayTimetableCell,
  type DayTimetablePayload,
  type DayTimetableRowFrame,
  type RoomGroup,
};

const DEFAULT_TUTOR_COLOR_HEX = "#1d76c2";
const PERF_LOG_ENABLED = process.env.ENABLE_PERF_LOGS === "1";
const EMPTY_RECORDS: YearLessonRecord[] = [];
const EMPTY_YEAR_STATE: YearLessonState = {
  attendance: {},
  hiddenDates: {},
  overrides: {},
  rescheduleEntries: [],
  extraEntries: [],
};
const FEE_SYSTEM_START_YEAR = 2026;
const FEE_SYSTEM_START_MONTH = 5;
const FEE_OPENING_BALANCE_AS_OF_YEAR = 2026;
const FEE_OPENING_BALANCE_AS_OF_MONTH = 4;
const HK_WEEKDAY_SHORT_TO_CN: Record<string, string> = {
  Mon: "一",
  Tue: "二",
  Wed: "三",
  Thu: "四",
  Fri: "五",
  Sat: "六",
  Sun: "日",
};
const WEEKDAY_ORDER: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
};

function timeSortKey(raw: string): number {
  const s = String(raw ?? "").trim();
  if (!s || s === "—" || s === "待定") return Number.POSITIVE_INFINITY;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s.toUpperCase());
  if (!m) return Number.POSITIVE_INFINITY - 1;
  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Number.POSITIVE_INFINITY - 1;
  hh = hh % 12; // 12 AM/PM special-cased by adding below
  if (ap === "PM") hh += 12;
  return hh * 60 + mm;
}

type StudentRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  nickname_en: string | null;
  grade: string | null;
};

function normalizeTutorHex(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

function buildTutorColorByDisplayName(
  rows: Array<{
    name?: string | null;
    name_zh?: string | null;
    name_en?: string | null;
    color_hex?: string | null;
    status?: string | null;
  }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of rows) {
    if (String(t.status ?? "").trim() === TUTOR_STATUS_INACTIVE) continue;
    const n = String(t.name ?? "").trim();
    const z = String(t.name_zh ?? "").trim();
    const en = String(t.name_en ?? "").trim();
    const hex = normalizeTutorHex(String(t.color_hex ?? "")) ?? DEFAULT_TUTOR_COLOR_HEX;
    if (n) map.set(n, hex);
    if (z) map.set(z, hex);
    if (en) map.set(en, hex);
  }
  return map;
}

function normalizeWeekday(raw: unknown) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (["一", "二", "三", "四", "五", "六", "日"].includes(s)) return s;
  if (s.startsWith("星期")) {
    const c = s.slice(2, 3);
    if (["一", "二", "三", "四", "五", "六", "日"].includes(c)) return c;
  }
  const lower = s.toLowerCase();
  if (lower === "mon" || lower === "monday") return "一";
  if (lower === "tue" || lower === "tuesday") return "二";
  if (lower === "wed" || lower === "wednesday") return "三";
  if (lower === "thu" || lower === "thursday") return "四";
  if (lower === "fri" || lower === "friday") return "五";
  if (lower === "sat" || lower === "saturday") return "六";
  if (lower === "sun" || lower === "sunday") return "日";
  return s;
}

function toHkIsoDateFromMs(ms: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const { y, m, d } = readYmdParts(parts, { y: "2026", m: "01", d: "01" });
  return `${y}-${m}-${d}`;
}

function feeSystemStartMonth1to12(sheetYear: number): number {
  return sheetYear === FEE_SYSTEM_START_YEAR ? FEE_SYSTEM_START_MONTH : 1;
}

function buildBaseLessonCountsByWeekdayForMonth(year: number, month1to12: number): Record<string, number> {
  const out: Record<string, number> = {
    一: 0,
    二: 0,
    三: 0,
    四: 0,
    五: 0,
    六: 0,
    日: 0,
  };
  const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    weekday: "short",
  });
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, month1to12 - 1, d, 12));
    const short = weekdayFormatter.format(dt);
    const cn = HK_WEEKDAY_SHORT_TO_CN[short];
    if (cn) out[cn] += 1;
  }
  return out;
}

function getActiveWeekdaysForDate(records: YearLessonRecord[], dateIso: string): string[] {
  const normalized = records.map((r) => ({
    ...r,
    effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
    weekday: normalizeWeekday(r.weekday),
  }));
  const sorted = normalized.sort((a, b) => {
    const ed = String(a.effectiveDate).localeCompare(String(b.effectiveDate));
    if (ed !== 0) return ed;
    return a.createdAt - b.createdAt;
  });
  const active = getActiveScheduleRulesForDate(sorted, dateIso);
  const set = new Set<string>();
  for (const r of active) {
    const wd = normalizeWeekday(r.weekday);
    if (wd) set.add(wd);
  }
  return [...set].sort((a, b) => (WEEKDAY_ORDER[a] ?? 99) - (WEEKDAY_ORDER[b] ?? 99));
}

function buildFeePaymentToneByStudentId(
  studentIds: string[],
  studentsById: Map<string, StudentRow>,
  normalizedRecordsById: Map<string, YearLessonRecord[]>,
  stateById: Map<string, YearLessonState>,
  feeRows: Array<{
    student_id?: string;
    year?: number;
    month?: number;
    submitted_amount?: number | null;
    lesson_unit_price?: number | null;
    fee_pricing_grade?: string | null;
  }>,
  openingBalanceByStudentId: Record<string, number>,
  balanceAdjustmentByStudentId: Record<string, number>,
  heldBackYearsByStudentId: Record<string, number[]>,
  gradeHistoryByStudentId: GradeHistoryByStudentId,
  refYear: number,
  refMonth: number,
  dateIso: string,
  feeTierBundle: StudentFeeTierBundle,
): Record<string, DayTimetableFeePaymentTone> {
  const amountByKey = new Map<string, number>();
  const pricingByKey = new Map<string, { lessonUnitPrice: number; feePricingGrade: string }>();
  const baseByMonth = new Map<number, Record<string, number>>();
  const getBaseCounts = (m: number) => {
    const cached = baseByMonth.get(m);
    if (cached) return cached;
    const built = buildBaseLessonCountsByWeekdayForMonth(refYear, m);
    baseByMonth.set(m, built);
    return built;
  };
  for (const r of feeRows) {
    const sid = normalizeStudentId(String((r as { student_id?: string }).student_id ?? ""));
    const y = Number((r as { year?: number }).year);
    const mo = Number((r as { month?: number }).month);
    if (!sid || !Number.isFinite(y) || !Number.isFinite(mo)) continue;
    const amt = Number((r as { submitted_amount?: number }).submitted_amount ?? 0) || 0;
    amountByKey.set(`${sid}-${y}-${mo}`, amt);
    pricingByKey.set(`${sid}-${y}-${mo}`, {
      lessonUnitPrice: Number((r as { lesson_unit_price?: number | null }).lesson_unit_price ?? 0) || 0,
      feePricingGrade: String((r as { fee_pricing_grade?: string | null }).fee_pricing_grade ?? ""),
    });
  }
  function amountFor(normalizedSid: string, y: number, mo: number): number {
    return amountByKey.get(`${normalizedSid}-${y}-${mo}`) ?? 0;
  }
  function pricingFor(
    normalizedSid: string,
    y: number,
    mo: number,
  ): { lessonUnitPrice: number; feePricingGrade: string } {
    return (
      pricingByKey.get(`${normalizedSid}-${y}-${mo}`) ?? {
        lessonUnitPrice: 0,
        feePricingGrade: "",
      }
    );
  }
  const out: Record<string, DayTimetableFeePaymentTone> = {};
  for (const sid of studentIds) {
    const key = normalizeStudentId(sid);
    const currentSubmitted = amountFor(key, refYear, refMonth);
    const currentUnpaid = currentSubmitted <= 0;
    // Fast path: if current month is paid, no stripe and no need to compute balance-due breakdown.
    if (!currentUnpaid) {
      out[key] = "ok";
      continue;
    }
    const st = studentsById.get(key);
    if (!st) {
      out[key] = "ok";
      continue;
    }
    const records = normalizedRecordsById.get(key) ?? EMPTY_RECORDS;
    const state = stateById.get(key) ?? EMPTY_YEAR_STATE;
    const weekdays = getActiveWeekdaysForDate(records, dateIso);
    const extraCountByMonth = new Map<number, number>();
    for (const ex of state.extraEntries ?? []) {
      const toDate = String((ex as { date?: string | null }).date ?? "").trim();
      const originDate = String((ex as { originDate?: string | null }).originDate ?? "").trim();
      const iso = originDate && originDate !== toDate ? originDate : toDate;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
      if (!m) continue;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      if (y !== refYear || mo < 1 || mo > 12) continue;
      extraCountByMonth.set(mo, (extraCountByMonth.get(mo) ?? 0) + 1);
    }
    const feeStartMonth = feeSystemStartMonth1to12(refYear);

    let priorExpected = 0;
    let submittedBefore = 0;
    for (let m = feeStartMonth; m < refMonth; m += 1) {
      const base = getBaseCounts(m);
      const lessonCount =
        weekdays.reduce((sum, wd) => sum + (base[wd] ?? 0), 0) + (extraCountByMonth.get(m) ?? 0);
      const pricing = pricingFor(key, refYear, m);
      const gradeFor = gradeForFeePricing(
        String(st.grade ?? ""),
        refYear,
        m,
        pricing.feePricingGrade,
        heldBackYearsByStudentId[key],
        gradeHistoryByStudentId[key],
      );
      const tier = resolveFeeTierSettingsForStudent(feeTierBundle, st.id, refYear, m);
      const expected = sumSlotTuitionHkdByLessonCount({
        lessonCount,
        gradeFor,
        feeTierSettings: tier,
      });
      priorExpected += expected;
      submittedBefore += amountFor(key, refYear, m);
    }

    const baseCurrent = getBaseCounts(refMonth);
    const currentLessonCount =
      weekdays.reduce((sum, wd) => sum + (baseCurrent[wd] ?? 0), 0) + (extraCountByMonth.get(refMonth) ?? 0);
    const currentPricing = pricingFor(key, refYear, refMonth);
    const currentGradeFor = gradeForFeePricing(
      String(st.grade ?? ""),
      refYear,
      refMonth,
      currentPricing.feePricingGrade,
      heldBackYearsByStudentId[key],
      gradeHistoryByStudentId[key],
    );
    const currentTier = resolveFeeTierSettingsForStudent(
      feeTierBundle,
      st.id,
      refYear,
      refMonth,
    );
    const currentExpected = sumSlotTuitionHkdByLessonCount({
      lessonCount: currentLessonCount,
      gradeFor: currentGradeFor,
      feeTierSettings: currentTier,
    });
    const opening = refYear === FEE_OPENING_BALANCE_AS_OF_YEAR ? Number(openingBalanceByStudentId[key] ?? 0) || 0 : 0;
    const adjustment = Number(balanceAdjustmentByStudentId[key] ?? 0) || 0;
    const balanceBefore = opening + priorExpected - submittedBefore;
    const totalDue = balanceBefore + currentExpected + adjustment;
    const balanceDue = totalDue - currentSubmitted;
    if (balanceDue <= 0.005) {
      out[key] = "ok";
      continue;
    }
    if (currentExpected > 0 && balanceDue > currentExpected + 0.005) {
      out[key] = "many_months_unpaid";
    } else {
      out[key] = "unpaid_current";
    }
  }
  return out;
}

function studentMayAppearOnTimetableDate(
  records: YearLessonRecord[],
  state: YearLessonState,
  dateIso: string,
  targetWeekday: string,
  regularOnly: boolean,
): boolean {
  if (getActiveWeekdaysForDate(records, dateIso).includes(targetWeekday)) return true;
  if (regularOnly) return false;
  return studentHasMakeupOrExtraOnDate(state, dateIso, { includePendingOnFromDate: true });
}

/** 未在 classrooms.regular_period_max 設定時的預設上限 */
export const DEFAULT_REGULAR_PERIOD_MAX_BY_ROOM: Record<RoomGroup, number> = {
  B: 5,
  M前: 5,
  M後: 6,
  Hope: 6,
  "Hope 2": 5,
};

export function buildRegularPeriodMaxByRoom(
  classroomRows:
    | Array<{ name?: string | null; slug?: string | null; regular_period_max?: number | null }>
    | null
    | undefined,
): Record<RoomGroup, number> {
  const out: Record<RoomGroup, number> = { ...DEFAULT_REGULAR_PERIOD_MAX_BY_ROOM };
  for (const row of classroomRows ?? []) {
    const slug = String(row.slug ?? "").trim().toLowerCase();
    const name = String(row.name ?? "").trim();
    const group = SLUG_TO_ROOM_GROUP[slug] || name;
    if (!group) continue;
    const m = Number(row.regular_period_max);
    if (Number.isFinite(m) && m > 0) {
      out[group] = Math.min(99, Math.max(1, Math.floor(m)));
    } else if (out[group] == null) {
      out[group] = 5;
    }
  }
  return out;
}

export type FetchDayTimetableOptions = {
  /** true：只顯示恆常排課（不含補堂／加堂） */
  regularOnly: boolean;
  /**
   * Include inactive (paused) students' regular slots marked `isInactive`.
   * Used by Regular Class Timetable filters (Inactive / All).
   */
  includeInactiveSlots?: boolean;
  /**
   * Include vacated cancelled-original slots (`取消`).
   * Regular Class Timetable Cancelled tick needs these; Daily Timetable does not.
   */
  includeCancelledSlots?: boolean;
  /**
   * Include leave / pending makeup on the original lesson date.
   * Regular Class Timetable Pending makeup tick; Daily Timetable does not.
   */
  includePendingMakeupSlots?: boolean;
  /**
   * Include paused students when they have 加堂 / 補堂 on this date (Daily Timetable).
   * Does not show their regular 恆常 slots while paused.
   */
  includeInactiveMakeupSlots?: boolean;
};

type DayTimetableStaticBundle = {
  studentList: StudentRow[];
  timetablePermanentRemarksById: Record<string, string>;
  inactivePeriodsById: Record<string, StudentInactivePeriod[]>;
  tutorColorByName: Record<string, string>;
  regularPeriodMaxByRoom: Record<RoomGroup, number>;
  roomDisplayLabels: Record<RoomGroup, string>;
  extraRoomGroups: RoomGroup[];
  roomSlugByGroup: Record<string, string>;
  roomRegistry: RoomDisplayRegistry;
  examById: Record<string, string>;
  roomSlotTutorRules: RoomSlotTutorRule[];
  feeTierBundle: StudentFeeTierBundle;
};

const loadDayTimetableStaticBundle = unstable_cache(
  async (): Promise<DayTimetableStaticBundle> => {
    const supabase = getSupabaseAdmin();
    const [
      { data: students },
      { data: examRows },
      { data: periodRows },
      { data: tutorRows },
      { data: classroomRows },
      roomSlotTutorRules,
      feeTierBundle,
    ] = await Promise.all([
      supabase.from("students").select("id, name_zh, name_en, nickname_en, grade, timetable_permanent_remark").order("id"),
      supabase.from("student_exam_dates").select("student_id, exam_date"),
      supabase.from("student_visibility_periods").select("student_id, start_date, end_date, note"),
      supabase.from("tutors").select("name, name_zh, name_en, color_hex, status"),
      supabase.from("classrooms").select("name, slug, regular_period_max"),
      loadRoomSlotTutorRulesServer(supabase),
      loadStudentFeeTierSettingsAdmin(supabase),
    ]);

    const inactivePeriodsById = buildStudentInactivePeriodsById(periodRows ?? []);

    const examById: Record<string, string> = {};
    for (const row of examRows ?? []) {
      const sid = String((row as { student_id?: string }).student_id ?? "");
      if (sid) examById[sid] = String((row as { exam_date?: string | null }).exam_date ?? "");
    }

    const roomRegistry = buildRoomDisplayRegistry(classroomRows);

    const timetablePermanentRemarksById: Record<string, string> = {};
    for (const row of students ?? []) {
      const sid = String((row as { id?: string }).id ?? "").trim();
      if (!sid) continue;
      const text = String((row as { timetable_permanent_remark?: string | null }).timetable_permanent_remark ?? "").trim();
      if (text) timetablePermanentRemarksById[sid] = text;
    }

    return {
      studentList: (students ?? []) as StudentRow[],
      timetablePermanentRemarksById,
      inactivePeriodsById,
      tutorColorByName: Object.fromEntries(buildTutorColorByDisplayName(tutorRows ?? [])),
      regularPeriodMaxByRoom: buildRegularPeriodMaxByRoom(
        classroomRows as Array<{
          name?: string | null;
          slug?: string | null;
          regular_period_max?: number | null;
        }> | null,
      ),
      roomDisplayLabels: roomRegistry.displayLabelByGroup,
      extraRoomGroups: roomRegistry.extraGroups,
      roomSlugByGroup: roomRegistry.slugByGroup,
      roomRegistry,
      examById,
      roomSlotTutorRules,
      feeTierBundle,
    };
  },
  ["day-timetable-static-v10"],
  { revalidate: 300, tags: [SCHEDULE_CACHE_TAG_DAY_TIMETABLE] },
);

async function fetchDayTimetablePayloadUncached(
  year: number,
  month: number,
  day: number,
  options: FetchDayTimetableOptions,
): Promise<DayTimetablePayload> {
  const perfStartedAt = PERF_LOG_ENABLED ? Date.now() : 0;
  const perfDbStartedAt = PERF_LOG_ENABLED ? Date.now() : 0;
  const dateIso = toDayIso(year, month, day);
  const titleDate = `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
  const {
    regularOnly,
    includeInactiveSlots = false,
    includeCancelledSlots = false,
    includePendingMakeupSlots = false,
    includeInactiveMakeupSlots = false,
  } = options;

  const supabase = getSupabaseAdmin();
  const targetWeekday = weekdayCnFromIsoDateHk(dateIso);
  const [staticBundle, yearSchedule, timetableStyle] = await Promise.all([
    loadDayTimetableStaticBundle(),
    loadYearScheduleData(year),
    loadDayTimetableStyleSettings(),
  ]);
  const allStudentIds = staticBundle.studentList.map((s) => s.id).filter(Boolean);
  const [{ data: heldBackRows }, { data: gradeHistoryRows }] = allStudentIds.length
    ? await Promise.all([
        supabase
          .from("student_held_back_years")
          .select("student_id, promotion_year")
          .in("student_id", allStudentIds),
        supabase
          .from("student_grade_history")
          .select("student_id, academic_year, grade, status, note")
          .in("student_id", allStudentIds),
      ])
    : [
        { data: [] as Array<{ student_id?: string; promotion_year?: number }> },
        {
          data: [] as Array<{
            student_id?: string;
            academic_year?: string;
            grade?: string;
            status?: string;
            note?: string;
          }>,
        },
      ];
  const heldBackYearsByStudentId: Record<string, number[]> = {};
  for (const row of heldBackRows ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    const y = Math.trunc(
      Number(
        (row as { promotion_year?: number; academic_year?: number }).promotion_year ??
          (row as { academic_year?: number }).academic_year,
      ),
    );
    if (!sid || !Number.isFinite(y)) continue;
    if (!heldBackYearsByStudentId[sid]) heldBackYearsByStudentId[sid] = [];
    heldBackYearsByStudentId[sid].push(y);
  }
  const gradeHistoryByStudentId: GradeHistoryByStudentId = {};
  for (const row of gradeHistoryRows ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    const academicYear = String((row as { academic_year?: string }).academic_year ?? "").trim();
    const grade = String((row as { grade?: string }).grade ?? "").trim();
    if (!sid || !/^\d{4}-\d{2}$/.test(academicYear) || !grade) continue;
    if (!gradeHistoryByStudentId[sid]) gradeHistoryByStudentId[sid] = {};
    gradeHistoryByStudentId[sid][academicYear] = {
      academicYear,
      grade,
      status: (String((row as { status?: string }).status ?? "normal").toLowerCase() as
        | "normal"
        | "repeating"
        | "promoted"
        | "manual_adjustment"),
      note: String((row as { note?: string }).note ?? ""),
    };
  }
  const {
    regularPeriodMaxByRoom,
    roomDisplayLabels,
    extraRoomGroups,
    roomSlugByGroup,
    roomRegistry,
    tutorColorByName,
    examById,
    roomSlotTutorRules,
    feeTierBundle,
  } = staticBundle;
  const timetableRooms = listScheduleRoomGroups(roomRegistry);
  const timetableRoomSet = new Set(timetableRooms);
  const inactivePeriodsById = new Map(Object.entries(staticBundle.inactivePeriodsById));

  function mergedPeriodsForStudent(st: { id: string; grade?: string | null }) {
    return withAutoF6InactivePeriod({
      periods: inactivePeriodsById.get(st.id) ?? [],
      studentId: st.id,
      grade: getStudentGradeForDate({
        currentGrade: st.grade ?? "",
        dateIso,
        historyByAcademicYear: gradeHistoryByStudentId[st.id],
        heldBackYears: heldBackYearsByStudentId[st.id],
      }),
      year: Number(String(dateIso ?? "").slice(0, 4)) || year,
    });
  }

  const activeStudentList = filterActiveStudentsOnDate(
    staticBundle.studentList,
    inactivePeriodsById,
    year,
    dateIso,
  );
  const activeIdSet = new Set(activeStudentList.map((s) => s.id));
  const inactiveStudentList = includeInactiveSlots
    ? staticBundle.studentList.filter((st) => {
        if (activeIdSet.has(st.id)) return false;
        const periods = mergedPeriodsForStudent(st);
        // Regular Class Timetable: only pauses with Expected return — skip graduated / open-ended inactive.
        return isTemporarilyInactiveOnDateFromPeriods({ periods, dateIso });
      })
    : [];
  const inactiveOnDateStudentList = includeInactiveMakeupSlots
    ? staticBundle.studentList.filter((st) => {
        if (activeIdSet.has(st.id)) return false;
        return isStudentInactiveOnDateFromPeriods({
          periods: mergedPeriodsForStudent(st),
          dateIso,
        });
      })
    : [];
  const studentList = activeStudentList;

  const normalizedRecordsById = new Map(Object.entries(yearSchedule.normalizedRecordsById));
  const stateById = new Map(Object.entries(yearSchedule.stateById));

  if (includeInactiveMakeupSlots && !includeInactiveSlots && inactiveOnDateStudentList.length) {
    const inactiveIds = inactiveOnDateStudentList.map((st) => st.id);
    const [freshRecords, freshStates] = await Promise.all([
      loadLessonScheduleRecordsBatchServer(supabase, inactiveIds),
      loadLessonYearStatesBatchServer(supabase, inactiveIds, year),
    ]);
    for (const id of inactiveIds) {
      normalizedRecordsById.set(id, normalizeLessonRecords(freshRecords[id] ?? []));
      stateById.set(id, (freshStates[id] ?? EMPTY_YEAR_STATE) as YearLessonState);
    }
  }

  const inactiveMakeupStudentList =
    includeInactiveMakeupSlots && !includeInactiveSlots
      ? inactiveOnDateStudentList.filter((st) => {
          const state = stateById.get(st.id) ?? EMPTY_YEAR_STATE;
          return studentHasMakeupOrExtraOnDate(state, dateIso);
        })
      : [];
  const byTimeRoom: Record<string, DayTimetableCell[]> = {};
  const timeSet = new Set<string>();
  let skippedStudents = 0;
  const today = hkTodayYmd();
  const todayIso = toDayIso(today.y, today.m, today.d);

  function pushStudentDayRows(params: {
    st: (typeof studentList)[number];
    onlyRegular: boolean;
    isInactive: boolean;
    makeupOrExtraOnly?: boolean;
  }) {
    const { st, onlyRegular, isInactive, makeupOrExtraOnly = false } = params;
    const records = normalizedRecordsById.get(st.id) ?? EMPTY_RECORDS;
    const state = stateById.get(st.id) ?? EMPTY_YEAR_STATE;
    if (makeupOrExtraOnly) {
      if (!studentHasMakeupOrExtraOnDate(state, dateIso)) {
        skippedStudents += 1;
        return;
      }
    } else if (!studentMayAppearOnTimetableDate(records, state, dateIso, targetWeekday, onlyRegular)) {
      skippedStudents += 1;
      return;
    }

    const studentDisplayName = formatStudentDisplayName(
      { id: st.id, name_zh: st.name_zh, name_en: st.name_en, nickname_en: st.nickname_en },
      "compact",
    );

    const dayRows = buildDayTimetableRowsForDate(records, state, dateIso, todayIso, {
      roomSlotTutorRules,
      includePendingMakeup: includePendingMakeupSlots,
    })
      .map((r) => ({ ...r, normalizedRoom: resolveRoomGroupFromRegistry(r.room, roomRegistry) }))
      .filter((r) => {
        if (makeupOrExtraOnly && r.lessonType !== "加堂" && r.lessonType !== "補堂") {
          return false;
        }
        // Daily: hide vacated cancelled-original. Regular Class Timetable may keep them.
        if (r.lessonType === "取消" && !includeCancelledSlots) return false;
        if (onlyRegular && r.lessonType === "取消") return false;
        if (
          onlyRegular &&
          r.lessonType !== "恆常" &&
          r.lessonType !== PENDING_MAKEUP_TYPE_LABEL
        ) {
          return false;
        }
        // Inactive: keep regular slot; also show intentional extra / makeup on this date.
        if (
          isInactive &&
          r.lessonType !== "恆常" &&
          r.lessonType !== "加堂" &&
          r.lessonType !== "補堂" &&
          !(includePendingMakeupSlots && r.lessonType === PENDING_MAKEUP_TYPE_LABEL)
        ) {
          return false;
        }
        return Boolean(r.normalizedRoom && timetableRoomSet.has(r.normalizedRoom));
      });

    for (const row of dayRows) {
      const time = row.time || "—";
      const room = row.normalizedRoom as RoomGroup;
      const key = `${time}::${room}`;
      const list = byTimeRoom[key] ?? [];
      const tutorDisplay = row.tutorDisplay ?? "";
      const tutorKey = tutorDisplay.trim();
      const tutorColorHex =
        tutorKey && tutorKey !== "待定" && tutorKey !== "—"
          ? tutorColorByName[tutorKey]
          : undefined;
      list.push({
        studentId: st.id,
        name: studentDisplayName,
        grade: st.grade ?? "",
        scheduleRemarks: row.noteDisplay ?? "",
        lessonType: row.lessonType,
        tutorDisplay,
        tutorColorHex,
        pendingMakeupLabel: row.pendingMakeupLabel,
        ...(isInactive && row.lessonType === "恆常" ? { isInactive: true as const } : {}),
      });
      byTimeRoom[key] = list;
      timeSet.add(time);
    }
  }

  for (const st of studentList) {
    pushStudentDayRows({ st, onlyRegular: regularOnly, isInactive: false });
  }
  for (const st of inactiveStudentList) {
    pushStudentDayRows({ st, onlyRegular: false, isInactive: true });
  }
  for (const st of inactiveMakeupStudentList) {
    pushStudentDayRows({ st, onlyRegular: false, isInactive: false, makeupOrExtraOnly: true });
  }

  for (const key of Object.keys(byTimeRoom)) {
    const list = byTimeRoom[key];
    list.sort((a, b) => {
      const ia = a.isInactive ? 1 : 0;
      const ib = b.isInactive ? 1 : 0;
      if (ia !== ib) return ia - ib;
      const pa = LESSON_TYPE_DISPLAY_PRIORITY[a.lessonType] ?? 9;
      const pb = LESSON_TYPE_DISPLAY_PRIORITY[b.lessonType] ?? 9;
      if (pa !== pb) return pa - pb;
      return a.studentId.localeCompare(b.studentId);
    });
  }

  const times = Array.from(timeSet).sort((a, b) => {
    const ka = timeSortKey(a);
    const kb = timeSortKey(b);
    if (ka !== kb) return ka - kb;
    return a.localeCompare(b, "en", { numeric: true });
  });
  const rowFrames = times.map((time) => {
    let maxRows = 1;
    for (const room of timetableRooms) {
      const size = (byTimeRoom[`${time}::${room}`] ?? []).length;
      if (size > maxRows) maxRows = size;
    }
    return { time, maxRows };
  });

  const studentIdsOnTimetable = new Set<string>();
  for (const list of Object.values(byTimeRoom)) {
    for (const c of list) {
      studentIdsOnTimetable.add(c.studentId);
    }
  }
  const timetableStudentIds = Array.from(studentIdsOnTimetable);

  let feePaymentToneByStudentId: Record<string, DayTimetableFeePaymentTone> = {};
  if (!regularOnly && timetableStudentIds.length > 0) {
    const feeStartMonth = feeSystemStartMonth1to12(year);
    const [{ data: feeRowsAll }, { data: openingRows }, { data: adjustmentRows }] = await Promise.all([
      supabase
        .from("student_monthly_fee_records")
        .select("student_id, year, month, submitted_amount, lesson_unit_price, fee_pricing_grade")
        .eq("year", year)
        .gte("month", feeStartMonth)
        .lte("month", month)
        .in("student_id", timetableStudentIds),
      year === FEE_OPENING_BALANCE_AS_OF_YEAR
        ? supabase
            .from("student_fee_opening_balances")
            .select("student_id, opening_balance")
            .eq("as_of_year", FEE_OPENING_BALANCE_AS_OF_YEAR)
            .eq("as_of_month", FEE_OPENING_BALANCE_AS_OF_MONTH)
            .in("student_id", timetableStudentIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("student_fee_balance_adjustments")
        .select("student_id, amount")
        .in("student_id", timetableStudentIds),
    ]);

    const openingBalanceByStudentId: Record<string, number> = {};
    for (const row of (openingRows ?? []) as Array<{ student_id?: string; opening_balance?: number | null }>) {
      const sid = normalizeStudentId(String(row.student_id ?? ""));
      if (!sid) continue;
      openingBalanceByStudentId[sid] = Number(row.opening_balance ?? 0) || 0;
    }
    const balanceAdjustmentByStudentId: Record<string, number> = {};
    for (const row of (adjustmentRows ?? []) as Array<{ student_id?: string; amount?: number | null }>) {
      const sid = normalizeStudentId(String(row.student_id ?? ""));
      if (!sid) continue;
      balanceAdjustmentByStudentId[sid] = Number(row.amount ?? 0) || 0;
    }
    const studentsById = new Map(studentList.map((s) => [normalizeStudentId(s.id), s]));
    feePaymentToneByStudentId = buildFeePaymentToneByStudentId(
      timetableStudentIds,
      studentsById,
      normalizedRecordsById,
      stateById,
      ((feeRowsAll ?? []) as Array<{
        student_id?: string;
        year?: number;
        month?: number;
        submitted_amount?: number | null;
        lesson_unit_price?: number | null;
        fee_pricing_grade?: string | null;
      }>) ?? [],
      openingBalanceByStudentId,
      balanceAdjustmentByStudentId,
      heldBackYearsByStudentId,
      gradeHistoryByStudentId,
      year,
      month,
      dateIso,
      feeTierBundle,
    );
  }

  const perfDbElapsedMs = PERF_LOG_ENABLED ? Date.now() - perfDbStartedAt : 0;

  const payload = {
    year,
    month,
    day,
    dateIso,
    titleDate,
    examById,
    timetableRemarksById: {},
    timetablePermanentRemarksById: staticBundle.timetablePermanentRemarksById,
    byTimeRoom,
    rowFrames,
    regularPeriodMaxByRoom,
    roomDisplayLabels,
    extraRoomGroups,
    roomSlugByGroup,
    feePaymentToneByStudentId,
    timetableStyle,
  };

  if (PERF_LOG_ENABLED) {
    const elapsedMs = Date.now() - perfStartedAt;
    const computeMs = Math.max(0, elapsedMs - perfDbElapsedMs);
    console.info(
      `[perf] fetchDayTimetablePayloadUncached y=${year} m=${month} d=${day} regularOnly=${String(
        options.regularOnly,
      )} students=${studentList.length} skipped=${skippedStudents} timeSlots=${rowFrames.length} dbMs=${perfDbElapsedMs} computeMs=${computeMs} elapsedMs=${elapsedMs}`,
    );
  }

  return payload;
}

export async function fetchDayTimetablePayload(
  year: number,
  month: number,
  day: number,
  options: FetchDayTimetableOptions,
): Promise<DayTimetablePayload> {
  const regularOnly = options.regularOnly;
  const includeInactiveSlots = Boolean(options.includeInactiveSlots);
  const includeCancelledSlots = Boolean(options.includeCancelledSlots);
  const includePendingMakeupSlots = Boolean(options.includePendingMakeupSlots);
  const includeInactiveMakeupSlots = Boolean(options.includeInactiveMakeupSlots);

  return unstable_cache(
    () =>
      fetchDayTimetablePayloadUncached(year, month, day, {
        regularOnly,
        includeInactiveSlots,
        includeCancelledSlots,
        includePendingMakeupSlots,
        includeInactiveMakeupSlots,
      }),
    [
      "day-timetable-payload-v27",
      String(year),
      String(month),
      String(day),
      regularOnly ? "1" : "0",
      includeInactiveSlots ? "1" : "0",
      includeCancelledSlots ? "1" : "0",
      includePendingMakeupSlots ? "1" : "0",
      includeInactiveMakeupSlots ? "1" : "0",
    ],
    // Timetable data rarely needs sub-minute freshness; longer cache = fewer DB round-trips.
    { revalidate: 300, tags: [SCHEDULE_CACHE_TAG_DAY_TIMETABLE] },
  )();
}
