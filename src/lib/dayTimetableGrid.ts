import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { unstable_cache } from "next/cache";
import { SCHEDULE_CACHE_TAG_DAY_TIMETABLE } from "@/lib/scheduleCacheTags";
import {
  isPendingRescheduleEntry,
  PENDING_MAKEUP_TYPE_LABEL,
} from "@/lib/pendingMakeup";
import {
  getActiveScheduleRulesForDate,
} from "@/lib/lessonScheduleVersions";
import { buildDayTimetableRowsForDate } from "@/lib/dayTimetableScheduleRows";
import {
  LESSON_TYPE_DISPLAY_PRIORITY,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";
import { readYmdParts } from "@/lib/intlFormatParts";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { filterActiveStudentsOnDate, filterStudentsWithAnyActivityInYear, studentIdsOf } from "@/lib/activeStudentIds";
import {
  buildStudentInactivePeriodsById,
  isTemporarilyInactiveOnDateFromPeriods,
  withAutoF6InactivePeriod,
  type StudentInactivePeriod,
} from "@/lib/studentVisibility";
import { loadRoomSlotTutorRulesServer } from "@/lib/roomSlotTutorRules";
import type { RoomSlotTutorRule } from "@/lib/roomSlotTutorRules";
import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";
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

function normalizeYearState(raw: unknown): YearLessonState {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    attendance: (obj.attendance as Record<string, boolean>) ?? {},
    hiddenDates: (obj.hidden_dates as Record<string, boolean>) ?? (obj.hiddenDates as Record<string, boolean>) ?? {},
    overrides: (obj.overrides as YearLessonState["overrides"]) ?? {},
    rescheduleEntries: (obj.reschedule_entries as YearLessonState["rescheduleEntries"]) ?? [],
    extraEntries: (obj.extra_entries as YearLessonState["extraEntries"]) ?? [],
  };
}

function normalizeRecords(raw: unknown): YearLessonRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item as Record<string, unknown>;
      const weekday = normalizeWeekday(o.weekday ?? o.week_day ?? o.weekDay);
      const room = String(o.room ?? o.classroom ?? o.room_name ?? "").trim();
      const time = String(o.time ?? o.lesson_time ?? "").trim();
      const effectiveDate =
        typeof o.effectiveDate === "string"
          ? o.effectiveDate
          : typeof o.effective_date === "string"
            ? o.effective_date
            : undefined;
      const createdAtRaw = o.createdAt ?? o.created_at ?? 0;
      return {
        id: typeof o.id === "string" ? o.id : undefined,
        effectiveDate,
        weekday,
        time,
        room,
        tutor: typeof o.tutor === "string" ? o.tutor : undefined,
        lessonSummary: typeof o.lessonSummary === "string" ? o.lessonSummary : undefined,
        createdAt: Number(createdAtRaw) || 0,
      } as YearLessonRecord;
    })
    .filter((r) => r.weekday && r.room);
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
      const gradeFor = gradeForFeePricing(String(st.grade ?? ""), refYear, m, pricing.feePricingGrade);
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
    const balanceBefore = opening + priorExpected - submittedBefore;
    const totalDue = balanceBefore + currentExpected;
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
  for (const ex of state.extraEntries ?? []) {
    const toDate = String((ex as { date?: string | null }).date ?? "").trim();
    const originDate = String((ex as { originDate?: string | null }).originDate ?? "").trim();
    if (toDate === dateIso || (originDate && originDate === dateIso)) {
      return true;
    }
  }
  for (const e of state.rescheduleEntries ?? []) {
    const from = String(e.fromDate ?? "").trim();
    const to = String(e.toDate ?? "").trim();
    if (from === dateIso) return true;
    if (to === dateIso && !isPendingRescheduleEntry(e)) return true;
  }
  return false;
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
    const group = SLUG_TO_ROOM_GROUP[slug] ?? resolveRoomGroupFromRegistry(String(row.name ?? ""));
    if (!group || !ROOM_GROUPS.includes(group)) continue;
    const m = Number(row.regular_period_max);
    if (Number.isFinite(m) && m > 0) {
      out[group] = Math.min(99, Math.max(1, Math.floor(m)));
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
};

type DayTimetableStaticBundle = {
  studentList: StudentRow[];
  inactivePeriodsById: Record<string, StudentInactivePeriod[]>;
  tutorColorByName: Record<string, string>;
  regularPeriodMaxByRoom: Record<RoomGroup, number>;
  roomDisplayLabels: Record<RoomGroup, string>;
  roomRegistry: RoomDisplayRegistry;
  examById: Record<string, string>;
  roomSlotTutorRules: RoomSlotTutorRule[];
  feeTierBundle: StudentFeeTierBundle;
};

type DayTimetableYearScheduleData = {
  normalizedRecordsById: Record<string, YearLessonRecord[]>;
  stateById: Record<string, YearLessonState>;
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
      supabase.from("students").select("id, name_zh, name_en, nickname_en, grade").order("id"),
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

    return {
      studentList: (students ?? []) as StudentRow[],
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
      roomRegistry,
      examById,
      roomSlotTutorRules,
      feeTierBundle,
    };
  },
  ["day-timetable-static-v6"],
  { revalidate: 300, tags: [SCHEDULE_CACHE_TAG_DAY_TIMETABLE] },
);

const loadDayTimetableYearScheduleData = unstable_cache(
  async (year: number): Promise<DayTimetableYearScheduleData> => {
    const supabase = getSupabaseAdmin();
    const staticBundle = await loadDayTimetableStaticBundle();
    const studentsForYear = filterStudentsWithAnyActivityInYear(
      staticBundle.studentList,
      staticBundle.inactivePeriodsById,
      year,
    );
    const ids = studentIdsOf(studentsForYear);
    if (!ids.length) {
      return { normalizedRecordsById: {}, stateById: {} };
    }

    const [{ data: recRows, error: recErr }, { data: stateRows, error: stateErr }] = await Promise.all([
      fetchRowsInChunks({
        ids,
        concurrency: 8,
        query: (chunk) =>
          supabase.from("student_lesson_records").select("student_id, records").in("student_id", chunk),
      }),
      fetchRowsInChunks({
        ids,
        concurrency: 8,
        query: (chunk) =>
          supabase
            .from("student_lessons_year_state")
            .select("student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
            .eq("year", year)
            .in("student_id", chunk),
      }),
    ]);

    if (recErr || stateErr) {
      throw new Error(recErr || stateErr || "Failed to load timetable year schedule data");
    }

    const normalizedRecordsById: Record<string, YearLessonRecord[]> = {};
    for (const row of recRows ?? []) {
      const sid = String((row as { student_id?: string }).student_id ?? "");
      if (!sid) continue;
      normalizedRecordsById[sid] = normalizeRecords((row as { records?: unknown }).records);
    }

    const stateById: Record<string, YearLessonState> = {};
    for (const row of stateRows ?? []) {
      const sid = String((row as { student_id?: string }).student_id ?? "");
      if (sid) stateById[sid] = normalizeYearState(row);
    }

    return { normalizedRecordsById, stateById };
  },
  ["day-timetable-year-schedule-v1"],
  { revalidate: 120, tags: [SCHEDULE_CACHE_TAG_DAY_TIMETABLE] },
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
  const { regularOnly, includeInactiveSlots = false, includeCancelledSlots = false, includePendingMakeupSlots = false } = options;

  const supabase = getSupabaseAdmin();
  const targetWeekday = weekdayCnFromIsoDateHk(dateIso);
  const [staticBundle, yearSchedule, timetableStyle, { data: remarkRows }] = await Promise.all([
    loadDayTimetableStaticBundle(),
    loadDayTimetableYearScheduleData(year),
    loadDayTimetableStyleSettings(),
    supabase.from("student_timetable_day_remarks").select("student_id, remarks").eq("date_iso", dateIso),
  ]);
  const { regularPeriodMaxByRoom, roomDisplayLabels, roomRegistry, tutorColorByName, examById, roomSlotTutorRules, feeTierBundle } =
    staticBundle;
  const inactivePeriodsById = new Map(Object.entries(staticBundle.inactivePeriodsById));

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
        const periods = withAutoF6InactivePeriod({
          periods: inactivePeriodsById.get(st.id) ?? [],
          studentId: st.id,
          grade: st.grade,
          year,
        });
        // Regular Class Timetable: only pauses with Expected return — skip graduated / open-ended inactive.
        return isTemporarilyInactiveOnDateFromPeriods({ periods, dateIso });
      })
    : [];
  const studentList = activeStudentList;

  const normalizedRecordsById = new Map(Object.entries(yearSchedule.normalizedRecordsById));
  const stateById = new Map(Object.entries(yearSchedule.stateById));
  const timetableRemarksById: Record<string, string> = {};
  for (const row of remarkRows ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    timetableRemarksById[sid] = String((row as { remarks?: string | null }).remarks ?? "");
  }
  const byTimeRoom: Record<string, DayTimetableCell[]> = {};
  const timeSet = new Set<string>();
  let skippedStudents = 0;
  const today = hkTodayYmd();
  const todayIso = toDayIso(today.y, today.m, today.d);

  function pushStudentDayRows(params: {
    st: (typeof studentList)[number];
    onlyRegular: boolean;
    isInactive: boolean;
  }) {
    const { st, onlyRegular, isInactive } = params;
    const records = normalizedRecordsById.get(st.id) ?? EMPTY_RECORDS;
    const state = stateById.get(st.id) ?? EMPTY_YEAR_STATE;
    if (!studentMayAppearOnTimetableDate(records, state, dateIso, targetWeekday, onlyRegular)) {
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
        return ROOM_GROUPS.includes(r.normalizedRoom as RoomGroup);
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
    pushStudentDayRows({ st, onlyRegular: true, isInactive: true });
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
    for (const room of ROOM_GROUPS) {
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
    const [{ data: feeRowsAll }, { data: openingRows }] = await Promise.all([
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
    ]);

    const openingBalanceByStudentId: Record<string, number> = {};
    for (const row of (openingRows ?? []) as Array<{ student_id?: string; opening_balance?: number | null }>) {
      const sid = normalizeStudentId(String(row.student_id ?? ""));
      if (!sid) continue;
      openingBalanceByStudentId[sid] = Number(row.opening_balance ?? 0) || 0;
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
    timetableRemarksById,
    byTimeRoom,
    rowFrames,
    regularPeriodMaxByRoom,
    roomDisplayLabels,
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

const fetchDayTimetablePayloadCached = unstable_cache(
  async (
    year: number,
    month: number,
    day: number,
    regularOnly: boolean,
    includeInactiveSlots: boolean,
    includeCancelledSlots: boolean,
    includePendingMakeupSlots: boolean,
  ) =>
    fetchDayTimetablePayloadUncached(year, month, day, {
      regularOnly,
      includeInactiveSlots,
      includeCancelledSlots,
      includePendingMakeupSlots,
    }),
  ["day-timetable-payload-v22"],
  /** Timetable data rarely needs sub-minute freshness; longer cache = fewer DB round-trips. */
  { revalidate: 120, tags: [SCHEDULE_CACHE_TAG_DAY_TIMETABLE] },
);

export async function fetchDayTimetablePayload(
  year: number,
  month: number,
  day: number,
  options: FetchDayTimetableOptions,
): Promise<DayTimetablePayload> {
  return fetchDayTimetablePayloadCached(
    year,
    month,
    day,
    options.regularOnly,
    Boolean(options.includeInactiveSlots),
    Boolean(options.includeCancelledSlots),
    Boolean(options.includePendingMakeupSlots),
  );
}
