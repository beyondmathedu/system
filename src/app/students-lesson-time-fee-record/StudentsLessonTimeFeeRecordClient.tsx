/* eslint-disable react/no-array-index-key */
"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import AppTopNav from "@/components/AppTopNav";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { supabase } from "@/lib/supabase";
import {
  loadLessonScheduleRecordsBatch,
  loadLessonYearStatesBatch,
  loadStudentMonthlyFeeRecords,
  upsertStudentMonthlyFeeRecord,
  type StudentLesson2026State,
} from "@/lib/studentLessonStorage";
import { readMonthPart, readYmdParts } from "@/lib/intlFormatParts";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";
import { normalizeStudentId } from "@/lib/studentId";
import { formatGradeDisplay, gradeRank, normalizeGradeCode } from "@/lib/grade";
import {
  buildSlotPricesInLOrder,
  inferGradeAtSheetEnd,
  isLowerFeeTier,
} from "@/lib/studentFeePricingGrade";
import {
  DEFAULT_FEE_TIER_SETTINGS,
  loadStudentFeeTierSettings,
  saveStudentFeeTierSettings,
  type StudentFeeTierSettings,
} from "@/lib/studentFeeTierSettings";
import {
  getPriorMonthMakeupWindow,
  getUpcomingUntickedDates,
  type Lesson2026Record,
  type Lesson2026State,
} from "@/lib/lesson2026Summary";
import { getActiveScheduleRulesForDate } from "@/lib/lessonScheduleVersions";

type StudentRow = {
  id: string;
  name_zh: string;
  name_en: string;
  nickname_en: string;
  grade: string;
  student_phone: string;
};

const L_COUNT = 9;
const START_YEAR = 2026;
// Fee accounting: lock legacy history into an opening balance, then start auto-calculation from this month.
const FEE_SYSTEM_START_YEAR = 2026;
const FEE_SYSTEM_START_MONTH = 5; // 2026/05
const OPENING_BALANCE_AS_OF_YEAR = 2026;
const OPENING_BALANCE_AS_OF_MONTH = 4; // balance as of end of 2026/04
const STICKY_ID_WIDTH = 88;
/** Narrow sticky column; long names wrap to 2 lines (see StudentFeeRow). */
const STICKY_NAME_WIDTH = 76;
const STICKY_GRADE_WIDTH = 84;
const STICKY_PHONE_WIDTH = 132;
const WEEKDAY_COL_WIDTH = 86;
const SESSION_COL_WIDTH = 104;
const TUITION_COL_WIDTH = 96;
const AMOUNT_OWING_COL_WIDTH = 92;
const OPENING_COL_WIDTH = 112;
const L_COL_WIDTH = 56;
const MAKEUP_COL_WIDTH = 104;
const SEND_FEE_COL_WIDTH = 88;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** English copy for opening-balance column / tooltips (calendar month-end). */
const OPENING_BALANCE_AS_OF_EN_PHRASE = `end of ${MONTH_SHORT[OPENING_BALANCE_AS_OF_MONTH - 1]} ${OPENING_BALANCE_AS_OF_YEAR}`;
const FEE_SYSTEM_START_EN_PHRASE = `${MONTH_SHORT[FEE_SYSTEM_START_MONTH - 1]} ${FEE_SYSTEM_START_YEAR}`;
const WEEKDAY_ORDER: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
};
const HK_WEEKDAY_CN_TO_EN: Record<string, string> = {
  一: "Mon",
  二: "Tue",
  三: "Wed",
  四: "Thu",
  五: "Fri",
  六: "Sat",
  日: "Sun",
};

const HK_WEEKDAY_SHORT_TO_CN: Record<string, string> = {
  Mon: "一",
  Tue: "二",
  Wed: "三",
  Thu: "四",
  Fri: "五",
  Sat: "六",
  Sun: "日",
};

function hkMonthNow(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
  }).formatToParts(new Date());
  return Number(readMonthPart(parts, "1")) || 1;
}

function formatPhoneNumberTwoLines(phone: string): string {
  const value = phone.trim();
  if (value.length <= 8) return value;
  return `${value.slice(0, 8)}\n${value.slice(8)}`;
}

function emptyLessonYearState(): StudentLesson2026State {
  return {
    attendance: {},
    hiddenDates: {},
    overrides: {},
    rescheduleEntries: [],
    extraEntries: [],
  };
}

/** "2026-05-08" → "5/8" */
function isoYmdToMonthDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function formatHkMoneyAmount(n: number): string {
  const v = Math.round(n * 100) / 100;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

/** 列表／彈窗用：港幣後附本月檔期堂數，例如 $1840(8堂) */
function formatHkdWithLessons(amount: number, lessonCount: number | null | undefined): string {
  const amt = formatHkMoneyAmount(amount);
  const raw = lessonCount == null ? NaN : Number(lessonCount);
  const n = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : NaN;
  if (!Number.isFinite(n)) return `$${amt}`;
  return `$${amt}(${n}堂)`;
}

/** 已繳欄括號堂數：劃一每堂價合理→已繳÷單價；否則 L 檔有日期堂數；再否則 Expected。 */
function tuitionPaidLessonHintCount(params: {
  submitted: number;
  flatUnit: number;
  monthDatedSlotCount: number;
  expectedSessions: number;
}): number | null {
  const { submitted, flatUnit, monthDatedSlotCount, expectedSessions } = params;
  if (submitted <= 0) return null;
  if (flatUnit >= 50) {
    const approx = Math.round(submitted / flatUnit);
    if (approx >= 1 && approx <= 32) return approx;
  }
  if (monthDatedSlotCount > 0) return monthDatedSlotCount;
  const exp = Math.round(Number(expectedSessions) || 0);
  if (exp > 0 && exp <= 32) return exp;
  return null;
}

/** 期初結餘欄：按學生年級（截至期初月底）估算約幾堂。 */
function openingBalanceLessonHintCount(params: {
  openingBalance: number;
  gradeForPricing: string;
  feeTierSettings: StudentFeeTierSettings;
}): number | null {
  const { openingBalance, gradeForPricing, feeTierSettings } = params;
  const abs = Math.abs(Number(openingBalance) || 0);
  if (abs < 0.005) return null;
  const low = isLowerFeeTier(gradeForPricing);
  const perLesson = low ? feeTierSettings.f_low_tier_1_8 : feeTierSettings.f_high_tier_1_8;
  if (perLesson < 50) return null;
  const approx = Math.round(abs / perLesson);
  if (approx >= 1 && approx <= 32) return approx;
  return null;
}

/** 忽略資料庫殘值（如 $1）；真正劃一每堂價一般 ≥ $50。 */
function effectiveFlatLessonUnit(price: number): number {
  const n = Number(price) || 0;
  return n >= 50 ? n : 0;
}

function formatSheetMonthZh(year: number, month1to12: number): string {
  return `${year} 年 ${month1to12} 月`;
}

type MonthlyArrearsRow = {
  key: string;
  monthLabel: string;
  expected: number;
  lessonCount: number;
  paid: number;
  outstanding: number;
  isLegacyOpening?: boolean;
};

function formatTuitionCell(amount: number, lessonCount: number, isLegacyOpening?: boolean): string {
  if (isLegacyOpening || lessonCount <= 0) return `$${formatHkMoneyAmount(amount)}`;
  return formatHkdWithLessons(amount, lessonCount);
}

function countDatedLessonSlots(dates: string[]): number {
  return dates.filter((d) => String(d ?? "").trim()).length;
}

/** 欠款明細表：期初結餘（如有）＋ 系統起算月至當前表月份，每月應繳／已繳／尚欠。 */
function buildMonthlyArrearsRows(params: {
  student: StudentRow;
  sheetYear: number;
  sheetMonth: number;
  openingBalance: number;
  currentRecord: RecordState;
  historicalMonthFee: Partial<Record<number, { lessonUnitPrice: number; feePricingGrade: string }>>;
  submittedByMonth: Partial<Record<number, number>>;
  weekdays: string[];
  extraEntries: Array<{ id: string; date: string }>;
  feeTierSettings: StudentFeeTierSettings;
}): MonthlyArrearsRow[] {
  const {
    student,
    sheetYear,
    sheetMonth,
    openingBalance,
    currentRecord,
    historicalMonthFee,
    submittedByMonth,
    weekdays,
    extraEntries,
    feeTierSettings,
  } = params;
  const rows: MonthlyArrearsRow[] = [];
  if (sheetYear === OPENING_BALANCE_AS_OF_YEAR && Math.abs(openingBalance) >= 0.005) {
    rows.push({
      key: "opening",
      monthLabel: `截至 ${OPENING_BALANCE_AS_OF_YEAR} 年 ${OPENING_BALANCE_AS_OF_MONTH} 月底（期初結餘）`,
      expected: openingBalance,
      lessonCount: 0,
      paid: 0,
      outstanding: openingBalance,
      isLegacyOpening: true,
    });
  }
  const feeStart = feeSystemStartMonth1to12(sheetYear);
  for (let m = feeStart; m <= sheetMonth; m += 1) {
    const dates = collectSortedUniqueLessonDatesForMonth({
      year: sheetYear,
      month1to12: m,
      weekdays,
      extraEntries,
    });
    const lessonCount = countDatedLessonSlots(dates);
    const hist = historicalMonthFee[m];
    const flat = effectiveFlatLessonUnit(
      m === sheetMonth ? currentRecord.lessonUnitPrice : Number(hist?.lessonUnitPrice ?? 0) || 0,
    );
    const gradeFor = gradeForFeePricing(
      student,
      sheetYear,
      m,
      m === sheetMonth ? currentRecord.feePricingGrade : String(hist?.feePricingGrade ?? ""),
    );
    const expected = sumSlotTuitionHkd({
      fullLessonDates: dates,
      flatUnit: flat,
      gradeFor,
      feeTierSettings,
    });
    const paid =
      m === sheetMonth ? Number(currentRecord.submitted) || 0 : Number(submittedByMonth[m] ?? 0) || 0;
    rows.push({
      key: `${sheetYear}-${m}`,
      monthLabel: formatSheetMonthZh(sheetYear, m),
      expected,
      lessonCount,
      paid,
      outstanding: expected - paid,
    });
  }
  return rows;
}

function priorMonthMakeupShortLabel(nowMs = Date.now()): string {
  const m = Number(getPriorMonthMakeupWindow(nowMs).startIso.slice(5, 7));
  return `${m}月未補堂`;
}

function FeeRecordRemarksField({
  label,
  remarks,
  onRemarksChange,
}: {
  label: string;
  remarks: string;
  onRemarksChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-slate-600">{label}</span>
      <textarea
        value={remarks}
        onChange={(e) => onRemarksChange(e.target.value)}
        rows={3}
        placeholder="備註（會自動儲存）"
        className="w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2] focus:ring-1 focus:ring-[#1d76c2]/30"
      />
    </label>
  );
}

function makeupDialogTitle(
  studentId: string,
  students: StudentRow[],
  liveCount: number,
  remedialCountDb: number,
): string {
  const st = students.find((s) => s.id === studentId);
  const studentLabel = st
    ? formatStudentDisplayNameOrEmpty(
        { id: st.id, name_zh: st.name_zh, name_en: st.name_en, nickname_en: st.nickname_en },
        "full",
      )
    : studentId;
  const count = liveCount > 0 ? liveCount : remedialCountDb;
  return `📅 ${studentLabel} – ${priorMonthMakeupShortLabel()} (${count}堂)`;
}

function FeeMakeupDetailPanel({
  dates,
  dbOnly,
  remedialCountDb,
  makeupRemarks,
  onMakeupRemarksChange,
}: {
  dates: string[];
  dbOnly: boolean;
  remedialCountDb: number;
  makeupRemarks: string;
  onMakeupRemarksChange: (value: string) => void;
}) {
  const count = dates.length;
  const dateLine = dates.map(isoYmdToMonthDay).join(", ");

  return (
    <div className="space-y-4">
      {count > 0 ? (
        <p className="break-words text-[0.9375rem] leading-relaxed text-slate-700">
          <span className="mr-1 text-slate-500" aria-hidden>
            ▸
          </span>
          {dateLine}
        </p>
      ) : dbOnly ? (
        <p className="text-xs text-slate-600">
          資料庫紀錄尚有 {remedialCountDb} 堂，但暫時載入唔到課表日期。請到該生課表頁同步後再試。
        </p>
      ) : (
        <p className="text-xs text-slate-600">{priorMonthMakeupShortLabel()}：暫無未補堂日期。</p>
      )}
      <FeeRecordRemarksField
        label="補堂備註"
        remarks={makeupRemarks}
        onRemarksChange={onMakeupRemarksChange}
      />
    </div>
  );
}

function FeeArrearsDetailTable({
  rows,
  totalOutstanding,
  balanceDueRemarks,
  onBalanceDueRemarksChange,
}: {
  rows: MonthlyArrearsRow[];
  totalOutstanding: number;
  balanceDueRemarks: string;
  onBalanceDueRemarksChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[20rem] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700">
              <th className="px-2.5 py-2">月份</th>
              <th className="px-2.5 py-2 text-right">應繳學費</th>
              <th className="px-2.5 py-2 text-right">已繳金額</th>
              <th className="px-2.5 py-2 text-right">尚欠</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-slate-100 last:border-0">
                <td className="px-2.5 py-2 text-slate-800">{row.monthLabel}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-slate-800">
                  {formatTuitionCell(row.expected, row.lessonCount, row.isLegacyOpening)}
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums text-slate-700">
                  ${formatHkMoneyAmount(row.paid)}
                </td>
                <td
                  className={`px-2.5 py-2 text-right font-semibold tabular-nums ${
                    row.outstanding > 0.005
                      ? "text-rose-700"
                      : row.outstanding < -0.005
                        ? "text-emerald-700"
                        : "text-slate-600"
                  }`}
                >
                  ${formatHkMoneyAmount(row.outstanding)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
        <p className="font-bold text-slate-900">
          總結尚欠總額：$
          <span className="tabular-nums">{formatHkMoneyAmount(Math.max(0, totalOutstanding))}</span>
        </p>
        {totalOutstanding < -0.005 ? (
          <p className="mt-1 text-emerald-800">
            多繳 ${formatHkMoneyAmount(-totalOutstanding)}，可留待下次抵扣。
          </p>
        ) : totalOutstanding <= 0.005 ? (
          <p className="mt-1 text-slate-600">各月已結清。</p>
        ) : null}
      </div>
      <FeeRecordRemarksField
        label="欠款備註"
        remarks={balanceDueRemarks}
        onRemarksChange={onBalanceDueRemarksChange}
      />
    </div>
  );
}

function feeSystemStartMonth1to12(sheetYear: number): number {
  return sheetYear === FEE_SYSTEM_START_YEAR ? FEE_SYSTEM_START_MONTH : 1;
}

function buildBaseLessonDatesByWeekdayForMonth(year: number, month1to12: number): Record<string, string[]> {
  const out: Record<string, string[]> = {
    一: [],
    二: [],
    三: [],
    四: [],
    五: [],
    六: [],
    日: [],
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
    if (cn) out[cn].push(`${month1to12}/${d}`);
  }
  return out;
}

function collectSortedUniqueLessonDatesForMonth(params: {
  year: number;
  month1to12: number;
  weekdays: string[];
  extraEntries: Array<{ id: string; date: string }>;
}): string[] {
  const { year, month1to12, weekdays, extraEntries } = params;
  const baseMap = buildBaseLessonDatesByWeekdayForMonth(year, month1to12);
  const base: string[] = [];
  for (const wd of weekdays) {
    base.push(...(baseMap[wd] ?? []));
  }
  for (const e of extraEntries) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
    if (!m) continue;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y === year && mo === month1to12) {
      base.push(`${mo}/${d}`);
    }
  }
  base.sort((a, b) => {
    const [am, ad] = a.split("/").map((v) => Number(v));
    const [bm, bd] = b.split("/").map((v) => Number(v));
    if (am !== bm) return am - bm;
    return ad - bd;
  });
  return Array.from(new Set(base));
}

function sumSlotTuitionHkd(params: {
  fullLessonDates: string[];
  flatUnit: number;
  gradeFor: string;
  feeTierSettings: StudentFeeTierSettings;
}): number {
  const { fullLessonDates, gradeFor, feeTierSettings } = params;
  const flatUnit = effectiveFlatLessonUnit(params.flatUnit);
  if (flatUnit > 0) {
    const n = fullLessonDates.filter((d) => String(d ?? "").trim()).length;
    return n * flatUnit;
  }
  const slotPrices = buildSlotPricesInLOrder(fullLessonDates, gradeFor, feeTierSettings);
  return slotPrices.reduce((a, b) => a + b, 0);
}

function gradeForFeePricing(
  student: StudentRow,
  sheetYear: number,
  sheetMonth: number,
  feePricingGradeStored: string,
): string {
  const fgRaw = normalizeGradeCode(feePricingGradeStored);
  return /^F[1-6]$/.test(fgRaw) ? fgRaw : inferGradeAtSheetEnd(student.grade, sheetYear, sheetMonth);
}

/** 統計「所選月份」內已打勾嘅堂數（與 2026 課表頁 attendance key 一致） */
function countAttendedLessonsInMonth(params: {
  attendance: Record<string, boolean>;
  year: number;
  month1to12: number;
  extras: Array<{ id: string; date: string }>;
  reschedules: Array<{ id: string; toDate: string }>;
}): number {
  const { attendance, year, month1to12, extras, reschedules } = params;
  const prefix = `${year}-${String(month1to12).padStart(2, "0")}`;
  const extraById = new Map(extras.map((e) => [e.id, e]));
  const rescheduleById = new Map(reschedules.map((r) => [r.id, r]));
  let n = 0;
  for (const [key, v] of Object.entries(attendance)) {
    if (!v) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      if (key.startsWith(prefix)) n += 1;
      continue;
    }
    if (key.startsWith("extra:")) {
      const ex = extraById.get(key.slice("extra:".length));
      if (ex?.date?.startsWith(prefix)) n += 1;
      continue;
    }
    if (key.startsWith("reschedule:")) {
      const r = rescheduleById.get(key.slice("reschedule:".length));
      if (r?.toDate?.startsWith(prefix)) n += 1;
    }
  }
  return n;
}

function hkTodayYmd() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const { y: ys, m: ms, d: ds } = readYmdParts(parts, { y: "2026", m: "01", d: "01" });
  return { y: Number(ys) || 2026, m: Number(ms) || 1, d: Number(ds) || 1 };
}

function monthEndIso(year: number, month1to12: number) {
  const day = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  return `${year}-${String(month1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const defaultRecordState = (): RecordState => ({
  weekday: "",
  expected: 0,
  submitted: 0,
  lessonUnitPrice: 0,
  feePricingGrade: "",
  lValues: Array.from({ length: L_COUNT }, () => 0),
  remedialCount: 0,
  remarks: "",
  makeupRemarks: "",
  balanceDueRemarks: "",
  sendFee: false,
});

type RecordState = {
  weekday: string;
  expected: number;
  submitted: number;
  /** 非 0 時：全月每堂同一單價（覆蓋階梯）；0 ＝用全站 F1–F3 / F4–F6 階梯。 */
  lessonUnitPrice: number;
  /** 空字串＝自動（按該月最後一日反推年級 + 9·1 升級）；否則 F1–F6 鎖定計價年級。 */
  feePricingGrade: string;
  lValues: number[];
  remedialCount: number;
  remarks: string;
  makeupRemarks: string;
  balanceDueRemarks: string;
  sendFee: boolean;
};

type LessonRecord = {
  effectiveDate?: string;
  weekday: string;
  createdAt: number;
};

type SortDirection = "asc" | "desc";
type SortKey = "id" | "name" | "grade" | "weekday" | "expected" | "submitted";
type SortConfig = { key: SortKey; direction: SortDirection } | null;

export default function StudentsLessonTimeFeeRecordPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [sheetMonth, setSheetMonth] = useState(() => hkMonthNow());
  const availableYears = useMemo(() => {
    const now = hkTodayYmd();
    const openNextYear = now.m === 12 && now.d >= 1;
    const maxYear = openNextYear ? now.y + 1 : now.y;
    if (maxYear < START_YEAR) return [START_YEAR];
    return Array.from({ length: maxYear - START_YEAR + 1 }, (_, i) => START_YEAR + i);
  }, []);
  const [sheetYear, setSheetYear] = useState(() => {
    const now = hkTodayYmd();
    return Math.max(START_YEAR, now.y);
  });
  const [recordsByStudentId, setRecordsByStudentId] = useState<Record<string, RecordState>>({});
  const [submittedByStudentMonth, setSubmittedByStudentMonth] = useState<
    Record<string, Partial<Record<number, number>>>
  >({});
  const [openingBalanceByStudentId, setOpeningBalanceByStudentId] = useState<Record<string, number>>(
    {},
  );
  /** 已存庫嘅「計價年級／劃一價」（fee_start..上月），用於重算以往月應收港幣。 */
  const [historicalMonthFeeByStudentId, setHistoricalMonthFeeByStudentId] = useState<
    Record<string, Partial<Record<number, { lessonUnitPrice: number; feePricingGrade: string }>>>
  >({});
  const [lessonRecordsByStudentId, setLessonRecordsByStudentId] = useState<
    Record<string, LessonRecord[]>
  >({});
  const [extraEntriesByStudentId, setExtraEntriesByStudentId] = useState<
    Record<string, { id: string; date: string }[]>
  >({});
  const [attendanceByStudentId, setAttendanceByStudentId] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [rescheduleEntriesByStudentId, setRescheduleEntriesByStudentId] = useState<
    Record<string, { id: string; fromDate: string; toDate: string }[]>
  >({});
  const [remedialCountByStudentId, setRemedialCountByStudentId] = useState<Record<string, number>>(
    {},
  );
  const [lessonYearStateByStudentId, setLessonYearStateByStudentId] = useState<
    Record<string, StudentLesson2026State>
  >({});
  const saveTimersRef = useState(() => new Map<string, number>())[0];
  const openingBalanceSaveTimersRef = useState(() => new Map<string, number>())[0];

  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [weekdayFilter, setWeekdayFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "underpaid" | "ok">("all");
  const [sessionFilter, setSessionFilter] = useState<"all" | "short" | "ok">("all");
  const [sendFeeFilter, setSendFeeFilter] = useState<"all" | "yes" | "no">("all");
  const [searchText, setSearchText] = useState("");
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomTrackRef = useRef<HTMLDivElement | null>(null);
  const sideTrackRef = useRef<HTMLDivElement | null>(null);
  const [bottomScrollWidth, setBottomScrollWidth] = useState(0);
  const [bottomScrollClientWidth, setBottomScrollClientWidth] = useState(0);
  const [sideScrollHeight, setSideScrollHeight] = useState(0);
  const [sideScrollClientHeight, setSideScrollClientHeight] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [feeTierSettings, setFeeTierSettings] = useState<StudentFeeTierSettings>({
    ...DEFAULT_FEE_TIER_SETTINGS,
  });
  const [feeTierDraft, setFeeTierDraft] = useState<StudentFeeTierSettings>({
    ...DEFAULT_FEE_TIER_SETTINGS,
  });
  const [feeTierSaveMsg, setFeeTierSaveMsg] = useState("");
  type FeeDetailDialogState =
    | { kind: "arrears"; studentId: string; title: string }
    | { kind: "makeup"; studentId: string };
  const [feeDetailDialog, setFeeDetailDialog] = useState<FeeDetailDialogState | null>(null);

  const onFeeDetailOpen = useCallback((dialog: FeeDetailDialogState) => {
    setFeeDetailDialog(dialog);
  }, []);

  useEffect(() => {
    if (!feeDetailDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFeeDetailDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [feeDetailDialog]);

  useEffect(() => {
    let m = true;
    void (async () => {
      const t = await loadStudentFeeTierSettings();
      if (!m) return;
      setFeeTierSettings(t);
      setFeeTierDraft(t);
    })();
    return () => {
      m = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [{ data }, { data: visibilityRows }] = await Promise.all([
        supabase.from("students").select("id, name_zh, name_en, nickname_en, grade, student_phone").order("id"),
        supabase.from("student_visibility_modes").select("student_id, mode, effective_date"),
      ]);
      if (!mounted) return;
      const cutoff = monthEndIso(sheetYear, Number(sheetMonth));
      const manualInactiveEffectiveById = new Map<string, string>();
      for (const row of visibilityRows ?? []) {
        const mode = String((row as any).mode ?? "active").toLowerCase();
        if (mode !== "inactive") continue;
        const sid = String((row as any).student_id ?? "");
        const eff = String((row as any).effective_date ?? "");
        if (sid && eff) manualInactiveEffectiveById.set(sid, eff);
      }
      const mapped: StudentRow[] = (data ?? []).map((r) => ({
        id: r.id,
        name_zh: String(r.name_zh ?? ""),
        name_en: String(r.name_en ?? ""),
        nickname_en: String(r.nickname_en ?? ""),
        grade: String(r.grade ?? ""),
        student_phone: String((r as { student_phone?: string | null }).student_phone ?? ""),
      }))
      .filter((s) => {
        const eff = resolveStudentInactiveEffectiveDate({
          grade: s.grade,
          manualInactiveEffective: manualInactiveEffectiveById.get(s.id) ?? null,
          year: sheetYear,
        });
        return !(eff && eff <= cutoff);
      });
      setStudents(mapped);

      setRecordsByStudentId((prev) => {
        const next = { ...prev };
        for (const st of mapped) {
          if (!next[st.id]) next[st.id] = defaultRecordState();
        }
        return next;
      });
    })();

    return () => {
      mounted = false;
    };
  }, [sheetMonth, sheetYear]);

  useEffect(() => {
    if (students.length === 0) return;
    let mounted = true;
    void (async () => {
      const { data, error } = await supabase
        .from("student_lessons_2026_metrics")
        .select("student_id, remedial_count")
        .in(
          "student_id",
          students.map((s) => s.id),
        );
      if (!mounted) return;
      if (error) return;
      const next: Record<string, number> = {};
      for (const row of data ?? []) {
        next[String((row as any).student_id)] = Number((row as any).remedial_count ?? 0) || 0;
      }
      setRemedialCountByStudentId(next);
    })();
    return () => {
      mounted = false;
    };
  }, [students]);

  useEffect(() => {
    if (students.length === 0) return;
    let mounted = true;
    void (async () => {
      const rows = await loadStudentMonthlyFeeRecords({
        studentIds: students.map((s) => s.id),
        year: sheetYear,
        month: Number(sheetMonth),
      });
      if (!mounted) return;
      setRecordsByStudentId((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          const id = r.student_id;
          if (!next[id]) next[id] = defaultRecordState();
          next[id] = {
            ...next[id],
            submitted: Number(r.submitted_amount ?? 0) || 0,
            lessonUnitPrice: Number(r.lesson_unit_price ?? 0) || 0,
            feePricingGrade: (() => {
              const raw = String((r as { fee_pricing_grade?: string | null }).fee_pricing_grade ?? "").trim();
              const c = normalizeGradeCode(raw);
              return /^F[1-6]$/.test(c) ? c : "";
            })(),
            remarks: String(r.remarks ?? ""),
            makeupRemarks: String((r as { makeup_remarks?: string | null }).makeup_remarks ?? ""),
            balanceDueRemarks: String((r as { balance_due_remarks?: string | null }).balance_due_remarks ?? ""),
            sendFee: Boolean(r.send_fee),
          };
        }
        return next;
      });
    })();
    return () => {
      mounted = false;
    };
  }, [students, sheetMonth, sheetYear]);

  useEffect(() => {
    if (students.length === 0) {
      setSubmittedByStudentMonth({});
      return;
    }
    let mounted = true;
    void (async () => {
      const currentMonth = Number(sheetMonth);
      const feeStartMonth = feeSystemStartMonth1to12(sheetYear);
      const { data } = await supabase
        .from("student_monthly_fee_records")
        .select("student_id, month, submitted_amount")
        .eq("year", sheetYear)
        .gte("month", feeStartMonth)
        .lte("month", currentMonth)
        .in("student_id", students.map((s) => s.id));
      if (!mounted) return;
      const next: Record<string, Partial<Record<number, number>>> = {};
      for (const r of data ?? []) {
        const sid = String((r as { student_id?: string }).student_id ?? "");
        const mo = Number((r as { month?: number }).month) || 0;
        if (!sid || !mo) continue;
        if (!next[sid]) next[sid] = {};
        next[sid][mo] = Number((r as { submitted_amount?: number | null }).submitted_amount ?? 0) || 0;
      }
      setSubmittedByStudentMonth(next);
    })();
    return () => {
      mounted = false;
    };
  }, [students, sheetMonth, sheetYear]);

  const submittedBeforeByStudentId = useMemo(() => {
    const currentMonth = Number(sheetMonth);
    const out: Record<string, number> = {};
    for (const st of students) {
      const byMonth = submittedByStudentMonth[st.id] ?? {};
      let sum = 0;
      for (const [mo, amt] of Object.entries(byMonth)) {
        if (Number(mo) < currentMonth) sum += Number(amt) || 0;
      }
      out[st.id] = sum;
    }
    return out;
  }, [students, sheetMonth, submittedByStudentMonth]);

  useEffect(() => {
    if (students.length === 0) {
      setHistoricalMonthFeeByStudentId({});
      return;
    }
    const currentMonth = Number(sheetMonth);
    const feeStartMonth = feeSystemStartMonth1to12(sheetYear);
    const endMonth = currentMonth - 1;
    if (endMonth < feeStartMonth) {
      setHistoricalMonthFeeByStudentId({});
      return;
    }
    let mounted = true;
    void (async () => {
      const { data } = await supabase
        .from("student_monthly_fee_records")
        .select("student_id, month, lesson_unit_price, fee_pricing_grade")
        .eq("year", sheetYear)
        .gte("month", feeStartMonth)
        .lte("month", endMonth)
        .in("student_id", students.map((s) => s.id));
      if (!mounted) return;
      const next: Record<
        string,
        Partial<Record<number, { lessonUnitPrice: number; feePricingGrade: string }>>
      > = {};
      for (const row of data ?? []) {
        const sid = String((row as { student_id?: string }).student_id ?? "");
        const mo = Number((row as { month?: number }).month) || 0;
        if (!sid || !mo) continue;
        if (!next[sid]) next[sid] = {};
        const rawG = String((row as { fee_pricing_grade?: string | null }).fee_pricing_grade ?? "").trim();
        const c = normalizeGradeCode(rawG);
        next[sid][mo] = {
          lessonUnitPrice: Number((row as { lesson_unit_price?: number | null }).lesson_unit_price ?? 0) || 0,
          feePricingGrade: /^F[1-6]$/.test(c) ? c : "",
        };
      }
      setHistoricalMonthFeeByStudentId(next);
    })();
    return () => {
      mounted = false;
    };
  }, [students, sheetMonth, sheetYear]);

  useEffect(() => {
    if (students.length === 0) {
      setOpeningBalanceByStudentId({});
      return;
    }
    // Only meaningful for the configured start year; other years default to 0.
    if (sheetYear !== OPENING_BALANCE_AS_OF_YEAR) {
      setOpeningBalanceByStudentId({});
      return;
    }
    let mounted = true;
    void (async () => {
      const { data, error } = await supabase
        .from("student_fee_opening_balances")
        .select("student_id, opening_balance")
        .eq("as_of_year", OPENING_BALANCE_AS_OF_YEAR)
        .eq("as_of_month", OPENING_BALANCE_AS_OF_MONTH)
        .in("student_id", students.map((s) => s.id));
      if (!mounted) return;
      if (error) return;
      const next: Record<string, number> = {};
      for (const row of data ?? []) {
        const sid = String((row as any).student_id ?? "");
        if (!sid) continue;
        next[sid] = Number((row as any).opening_balance ?? 0) || 0;
      }
      setOpeningBalanceByStudentId(next);
    })();
    return () => {
      mounted = false;
    };
  }, [students, sheetYear]);

  function scheduleSaveOpeningBalance(studentId: string, nextValue: number) {
    const key = `${studentId}:${OPENING_BALANCE_AS_OF_YEAR}:${OPENING_BALANCE_AS_OF_MONTH}`;
    const existing = openingBalanceSaveTimersRef.get(key);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      openingBalanceSaveTimersRef.delete(key);
      void supabase.from("student_fee_opening_balances").upsert(
        {
          student_id: studentId,
          as_of_year: OPENING_BALANCE_AS_OF_YEAR,
          as_of_month: OPENING_BALANCE_AS_OF_MONTH,
          opening_balance: Number(nextValue) || 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,as_of_year,as_of_month" },
      );
    }, 600);
    openingBalanceSaveTimersRef.set(key, t);
  }

  const onOpeningBalanceChange = useCallback((studentId: string, nextValue: number) => {
    setOpeningBalanceByStudentId((prev) => ({ ...prev, [studentId]: nextValue }));
    scheduleSaveOpeningBalance(studentId, nextValue);
  }, []);

  function scheduleSave(studentId: string, patch: Partial<RecordState>) {
    const key = `${studentId}:${sheetYear}:${sheetMonth}`;
    const existing = saveTimersRef.get(key);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      saveTimersRef.delete(key);
      const rec = recordsByStudentId[studentId] ?? defaultRecordState();
      const merged = { ...rec, ...patch };
      void upsertStudentMonthlyFeeRecord({
        studentId,
        year: sheetYear,
        month: Number(sheetMonth),
        submittedAmount: Number(merged.submitted ?? 0) || 0,
        lessonUnitPrice: Number(merged.lessonUnitPrice ?? 0) || 0,
        feePricingGrade: String(merged.feePricingGrade ?? ""),
        remarks: String(merged.remarks ?? ""),
        makeupRemarks: String(merged.makeupRemarks ?? ""),
        balanceDueRemarks: String(merged.balanceDueRemarks ?? ""),
        sendFee: Boolean(merged.sendFee),
      });
    }, 600);
    saveTimersRef.set(key, t);
  }

  const sortedStudents = useMemo(() => {
    const getRec = (id: string) => recordsByStudentId[id];

    return [...students].sort((a, b) => {
      // default: F1 -> F6, then by student ID
      if (!sortConfig) {
        const ga = gradeRank(a.grade);
        const gb = gradeRank(b.grade);
        if (ga !== gb) return ga - gb;
        return a.id.localeCompare(b.id);
      }

      const multiplier = sortConfig.direction === "asc" ? 1 : -1;
      const ra = getRec(a.id);
      const rb = getRec(b.id);

      let result = 0;
      switch (sortConfig.key) {
        case "id":
          result = a.id.localeCompare(b.id);
          break;
        case "name":
          result = (a.name_zh ?? "").localeCompare(b.name_zh ?? "", "zh-Hant");
          break;
        case "grade":
          result = gradeRank(a.grade) - gradeRank(b.grade);
          break;
        case "weekday":
          result = (ra?.weekday ?? "").localeCompare(rb?.weekday ?? "", "zh-Hant");
          break;
        case "expected":
          result = (ra?.expected ?? 0) - (rb?.expected ?? 0);
          break;
        case "submitted":
          result = (ra?.submitted ?? 0) - (rb?.submitted ?? 0);
          break;
        default:
          result = 0;
      }

      return result * multiplier;
    });
  }, [students, recordsByStudentId, sortConfig]);

  const weekdayTokensByStudentId = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const st of students) {
      out[st.id] = (recordsByStudentId[st.id]?.weekday ?? "")
        .split("/")
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return out;
  }, [students, recordsByStudentId]);

  const attendedLessonsInMonthByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    const m = Number(sheetMonth);
    for (const st of students) {
      out[st.id] = countAttendedLessonsInMonth({
        attendance: attendanceByStudentId[st.id] ?? {},
        year: sheetYear,
        month1to12: m,
        extras: extraEntriesByStudentId[st.id] ?? [],
        reschedules: rescheduleEntriesByStudentId[st.id] ?? [],
      });
    }
    return out;
  }, [
    students,
    sheetYear,
    sheetMonth,
    attendanceByStudentId,
    extraEntriesByStudentId,
    rescheduleEntriesByStudentId,
  ]);

  const filteredSortedStudents = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return sortedStudents.filter((st) => {
      const r = recordsByStudentId[st.id] ?? defaultRecordState();
      const expectedSessions = r.expected ?? 0;
      const attended = attendedLessonsInMonthByStudentId[st.id] ?? 0;
      const matchesGrade = gradeFilter === "all" || formatGradeDisplay(st.grade) === gradeFilter;
      const matchesWeekday =
        weekdayFilter === "all" ||
        (weekdayTokensByStudentId[st.id] ?? []).includes(weekdayFilter);
      const matchesPayment =
        paymentFilter === "all" ||
        (paymentFilter === "underpaid" ? r.submitted < r.expected : r.submitted >= r.expected);
      const matchesSession =
        sessionFilter === "all" ||
        (sessionFilter === "short"
          ? expectedSessions > 0 && attended < expectedSessions
          : expectedSessions === 0 || attended >= expectedSessions);
      const matchesSendFee =
        sendFeeFilter === "all" || (sendFeeFilter === "yes" ? Boolean(r.sendFee) : !r.sendFee);
      const displayName = formatStudentDisplayNameOrEmpty(
        { id: st.id, name_zh: st.name_zh, name_en: st.name_en, nickname_en: st.nickname_en },
        "full",
      ).toLowerCase();
      const normalizedId = normalizeStudentId(st.id).toLowerCase();
      const phoneText = st.student_phone.toLowerCase();
      const matchesSearch =
        normalizedSearch.length === 0 ||
        normalizedId.includes(normalizedSearch) ||
        st.id.toLowerCase().includes(normalizedSearch) ||
        displayName.includes(normalizedSearch) ||
        phoneText.includes(normalizedSearch);
      return (
        matchesGrade &&
        matchesWeekday &&
        matchesPayment &&
        matchesSession &&
        matchesSendFee &&
        matchesSearch
      );
    });
  }, [
    sortedStudents,
    recordsByStudentId,
    gradeFilter,
    weekdayFilter,
    paymentFilter,
    sessionFilter,
    sendFeeFilter,
    searchText,
    weekdayTokensByStudentId,
    attendedLessonsInMonthByStudentId,
  ]);

  const updateStudentRecord = (studentId: string, patch: Partial<RecordState>) => {
    setRecordsByStudentId((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] ?? defaultRecordState()),
        ...patch,
      },
    }));
  };

  const onSubmittedChange = useCallback(
    (studentId: string, submitted: number) => {
      updateStudentRecord(studentId, { submitted });
      scheduleSave(studentId, { submitted });
    },
    [scheduleSave],
  );

  const onRemarksChange = useCallback(
    (studentId: string, remarks: string) => {
      updateStudentRecord(studentId, { remarks });
      scheduleSave(studentId, { remarks });
    },
    [scheduleSave],
  );

  const onMakeupRemarksChange = useCallback(
    (studentId: string, makeupRemarks: string) => {
      updateStudentRecord(studentId, { makeupRemarks });
      scheduleSave(studentId, { makeupRemarks });
    },
    [scheduleSave],
  );

  const onBalanceDueRemarksChange = useCallback(
    (studentId: string, balanceDueRemarks: string) => {
      updateStudentRecord(studentId, { balanceDueRemarks });
      scheduleSave(studentId, { balanceDueRemarks });
    },
    [scheduleSave],
  );

  const onSendFeeChange = useCallback(
    (studentId: string, sendFee: boolean) => {
      updateStudentRecord(studentId, { sendFee });
      scheduleSave(studentId, { sendFee });
    },
    [scheduleSave],
  );

  const saveFeeTierSettings = useCallback(async () => {
    setFeeTierSaveMsg("");
    const res = await saveStudentFeeTierSettings(feeTierDraft);
    if (!res.ok) {
      setFeeTierSaveMsg(res.error ?? "Save failed");
      return;
    }
    setFeeTierSettings({ ...feeTierDraft });
    setFeeTierSaveMsg(res.cloudSynced ? "Saved + cloud" : "Saved locally");
    window.setTimeout(() => setFeeTierSaveMsg(""), 2800);
  }, [feeTierDraft]);

  const syncZohoSubmitted = useCallback(
    async (opts?: { studentIds?: string[]; idOnly?: boolean }) => {
    setSyncingZoho(true);
    setSyncNotice("");
    try {
      const ctl = new AbortController();
      const timeout = window.setTimeout(() => ctl.abort(), 90000);
      const resp = await fetch("/api/zoho/sync-submitted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: sheetYear,
          month: Number(sheetMonth),
          studentIds: opts?.studentIds,
          idOnly: Boolean(opts?.idOnly),
        }),
        signal: ctl.signal,
      });
      window.clearTimeout(timeout);
      const json = await resp.json();
      if (!resp.ok || !json?.ok) {
        throw new Error(String(json?.error ?? "sync_failed"));
      }
      const debug = (json?.debug ?? {}) as {
        matchedReceipts?: number;
        totalLineItems?: number;
        parsedMonthLineItems?: number;
        detailCalls?: number;
        skippedDetailByLimit?: number;
        detailFetchSuccess?: number;
        detailFetchEmpty?: number;
        detailFetchError?: number;
        detailErrorSamples?: string[];
      };
      const monthMap = (json?.monthSubmittedByStudentId ?? {}) as Record<string, number>;
      if (Object.keys(monthMap).length > 0) {
        setRecordsByStudentId((prev) => {
          const next = { ...prev };
          for (const [sid, submitted] of Object.entries(monthMap)) {
            next[sid] = {
              ...(next[sid] ?? defaultRecordState()),
              submitted: Number(submitted) || 0,
            };
          }
          return next;
        });
      }
      setSyncNotice(
        `Zoho synced (${sheetYear}). Fetched ${Number(json?.fetchedReceipts ?? 0)} receipts; updated ${Number(json?.syncedRows ?? 0)} rows; ${Number(json?.unmatchedReceipts ?? 0)} unmatched.${
          Array.isArray(json?.unmatchedExamples) && json.unmatchedExamples.length
            ? ` Unmatched examples: ${json.unmatchedExamples.join(" / ")}`
            : ""
        } Debug: matched ${Number(debug.matchedReceipts ?? 0)}, line items ${Number(debug.totalLineItems ?? 0)}, parsed-month items ${Number(debug.parsedMonthLineItems ?? 0)}, detail calls ${Number(debug.detailCalls ?? 0)}, skipped details ${Number(debug.skippedDetailByLimit ?? 0)}, detail success ${Number(debug.detailFetchSuccess ?? 0)}, detail empty ${Number(debug.detailFetchEmpty ?? 0)}, detail errors ${Number(debug.detailFetchError ?? 0)}${
          Array.isArray(debug.detailErrorSamples) && debug.detailErrorSamples.length
            ? `, detail error samples: ${debug.detailErrorSamples.join(" / ")}`
            : ""
        }.`,
      );
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("aborted")) {
        setSyncNotice("Sync timed out (>90s). Please try again. The system now syncs in batches, and the next attempt is usually faster.");
      } else {
        setSyncNotice(`Sync failed: ${msg}`);
      }
    } finally {
      setSyncingZoho(false);
    }
    },
    [sheetMonth, sheetYear],
  );

  function toHkIsoDateFromMs(msOrIso: number | string | Date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(msOrIso));

    const { y, m, d } = readYmdParts(parts);
    return `${y}-${m}-${d}`;
  }

  function getActiveWeekdays(records: LessonRecord[], dateIso: string) {
    if (!records.length) return [] as string[];
    const normalized = records
      .map((r) => {
        const rr = r as unknown as Record<string, unknown>;
        const weekday =
          String(rr.weekday ?? rr.week_day ?? rr.weekDay ?? rr.Weekday ?? "") || "";

        const effectiveDate =
          (typeof rr.effectiveDate === "string"
            ? rr.effectiveDate
            : typeof rr.effective_date === "string"
              ? rr.effective_date
              : undefined) ?? toHkIsoDateFromMs((rr.createdAt ?? rr.created_at) as any);

        const createdAtNum =
          typeof rr.createdAt === "number"
            ? rr.createdAt
            : typeof rr.created_at === "number"
              ? rr.created_at
              : Number(rr.createdAt ?? rr.created_at ?? 0);

        return {
          weekday,
          effectiveDate: String(effectiveDate),
          createdAt: Number.isFinite(createdAtNum) ? createdAtNum : 0,
        };
      })
      .filter((x) => x.weekday);

    normalized.sort((a, b) => {
      const ed = a.effectiveDate.localeCompare(b.effectiveDate);
      if (ed !== 0) return ed;
      return a.createdAt - b.createdAt;
    });

    const activeRules = getActiveScheduleRulesForDate(normalized, dateIso);
    const weekdays = activeRules.map((r) => r.weekday).filter(Boolean);
    weekdays.sort((a, b) => (WEEKDAY_ORDER[a] ?? 99) - (WEEKDAY_ORDER[b] ?? 99));
    return weekdays;
  }

  function countHkWeekdaysInMonth(year: number, month1to12: number) {
    const counts: Record<string, number> = {
      一: 0,
      二: 0,
      三: 0,
      四: 0,
      五: 0,
      六: 0,
      日: 0,
    };

    // Use UTC for day count to avoid local timezone drift.
    const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();

    // Compute weekdays in HK timezone to avoid server/client timezone mismatch.
    const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Hong_Kong",
      weekday: "short",
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(year, month1to12 - 1, d, 12)); // midday to avoid date-boundary drift
      const short = weekdayFormatter.format(dt);
      const cn = HK_WEEKDAY_SHORT_TO_CN[short];
      if (cn) counts[cn] += 1;
    }

    return counts;
  }

  useEffect(() => {
    if (students.length === 0) return;
    let mounted = true;
    void (async () => {
      const ids = students.map((s) => s.id);
      const [recordsMap, yearStatesMap] = await Promise.all([
        loadLessonScheduleRecordsBatch(ids),
        loadLessonYearStatesBatch(ids, sheetYear),
      ]);

      if (!mounted) return;

      const nextRecords: Record<string, LessonRecord[]> = {};
      const nextExtra: Record<string, { id: string; date: string }[]> = {};
      const nextAttendance: Record<string, Record<string, boolean>> = {};
      const nextReschedule: Record<string, { id: string; fromDate: string; toDate: string }[]> = {};
      const nextYearState: Record<string, StudentLesson2026State> = {};
      for (const st of students) {
        const id = st.id;
        let records: LessonRecord[] = [];
        const rawCloudRecords = recordsMap[id];
        if (Array.isArray(rawCloudRecords) && rawCloudRecords.length > 0) {
          records = rawCloudRecords as LessonRecord[];
        } else {
          // fallback: localStorage (when no cloud records exist)
          try {
            const key = `lesson_schedule_records:${id}`;
            const raw = window.localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw) as unknown;
              if (Array.isArray(parsed)) records = parsed as LessonRecord[];
            }
          } catch {
            // ignore
          }
        }
        nextRecords[id] = records;

        const yearState = yearStatesMap[id];
        const extraEntriesRaw =
          (yearState?.extraEntries as Array<{ id: string; date: string; time: string; room: string }>) ??
          [];
        nextExtra[id] = extraEntriesRaw.map((e) => ({ id: String(e.id ?? ""), date: String(e.date ?? "") }));

        nextAttendance[id] =
          yearState?.attendance && typeof yearState.attendance === "object"
            ? (yearState.attendance as Record<string, boolean>)
            : {};

        const rescheduleRaw =
          (yearState?.rescheduleEntries as Array<{ id: string; fromDate: string; toDate: string }>) ?? [];
        nextReschedule[id] = rescheduleRaw.map((e) => ({
          id: String(e.id ?? ""),
          fromDate: String(e.fromDate ?? ""),
          toDate: String(e.toDate ?? ""),
        }));
        nextYearState[id] = yearStatesMap[id] ?? emptyLessonYearState();
      }
      setLessonRecordsByStudentId(nextRecords);
      setExtraEntriesByStudentId(nextExtra);
      setAttendanceByStudentId(nextAttendance);
      setRescheduleEntriesByStudentId(nextReschedule);
      setLessonYearStateByStudentId(nextYearState);
    })();

    return () => {
      mounted = false;
    };
  }, [students, sheetYear]);

  const weekdayCountsInSelectedMonth = useMemo(() => {
    return countHkWeekdaysInMonth(sheetYear, Number(sheetMonth));
  }, [sheetMonth, sheetYear]);

  const baseLessonDatesByWeekday = useMemo(() => {
    const out: Record<string, string[]> = {
      一: [],
      二: [],
      三: [],
      四: [],
      五: [],
      六: [],
      日: [],
    };
    const daysInMonth = new Date(Date.UTC(sheetYear, Number(sheetMonth), 0)).getUTCDate();
    const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Hong_Kong",
      weekday: "short",
    });
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(sheetYear, Number(sheetMonth) - 1, d, 12));
      const short = weekdayFormatter.format(dt);
      const cn = HK_WEEKDAY_SHORT_TO_CN[short];
      if (cn) out[cn].push(`${Number(sheetMonth)}/${d}`);
    }
    return out;
  }, [sheetYear, sheetMonth]);

  const extraEntryCountsByStudentId = useMemo(() => {
    const out: Record<string, { before: number; current: number }> = {};
    const currentMonth = Number(sheetMonth);
    const feeStartMonth =
      sheetYear === FEE_SYSTEM_START_YEAR ? FEE_SYSTEM_START_MONTH : 1;
    for (const st of students) {
      out[st.id] = { before: 0, current: 0 };
      const extraEntries = extraEntriesByStudentId[st.id] ?? [];
      for (const e of extraEntries) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
        if (!m) continue;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        if (y !== sheetYear) continue;
        if (mo === currentMonth) out[st.id].current += 1;
        else if (mo < currentMonth && mo >= feeStartMonth) out[st.id].before += 1;
      }
    }
    return out;
  }, [students, extraEntriesByStudentId, sheetYear, sheetMonth]);

  const { lessonDatesByStudentId, fullLessonDatesByStudentId } = useMemo(() => {
    const capped: Record<string, string[]> = {};
    const full: Record<string, string[]> = {};
    for (const st of students) {
      const weekdays = weekdayTokensByStudentId[st.id] ?? [];
      const base: string[] = [];
      for (const wd of weekdays) {
        base.push(...(baseLessonDatesByWeekday[wd] ?? []));
      }
      const extraEntries = extraEntriesByStudentId[st.id] ?? [];
      for (const e of extraEntries) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
        if (!m) continue;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        if (y === sheetYear && mo === Number(sheetMonth)) {
          base.push(`${mo}/${d}`);
        }
      }
      base.sort((a, b) => {
        const [am, ad] = a.split("/").map((v) => Number(v));
        const [bm, bd] = b.split("/").map((v) => Number(v));
        if (am !== bm) return am - bm;
        return ad - bd;
      });
      const sorted = Array.from(new Set(base));
      full[st.id] = sorted;
      capped[st.id] = sorted.slice(0, L_COUNT);
    }
    return { lessonDatesByStudentId: capped, fullLessonDatesByStudentId: full };
  }, [
    students,
    weekdayTokensByStudentId,
    extraEntriesByStudentId,
    baseLessonDatesByWeekday,
    sheetYear,
    sheetMonth,
  ]);

  const feeDialogMakeupDetail = useMemo(() => {
    if (!feeDetailDialog || feeDetailDialog.kind !== "makeup") {
      return { dates: [] as string[], dbOnly: false, liveCount: 0 };
    }
    const sid = feeDetailDialog.studentId;
    const recs = (lessonRecordsByStudentId[sid] ?? []) as unknown as Lesson2026Record[];
    const ys = lessonYearStateByStudentId[sid] ?? emptyLessonYearState();
    const state: Lesson2026State = {
      attendance: ys.attendance,
      hiddenDates: ys.hiddenDates,
      overrides: (ys.overrides ?? {}) as Lesson2026State["overrides"],
      rescheduleEntries: (ys.rescheduleEntries as Lesson2026State["rescheduleEntries"]) ?? [],
      extraEntries: (ys.extraEntries as Lesson2026State["extraEntries"]) ?? [],
    };
    const dates = getUpcomingUntickedDates(recs, state, Date.now(), sheetYear);
    const dbN = remedialCountByStudentId[sid] ?? 0;
    return {
      dates,
      dbOnly: dates.length === 0 && dbN > 0,
      liveCount: dates.length,
    };
  }, [
    feeDetailDialog,
    lessonRecordsByStudentId,
    lessonYearStateByStudentId,
    sheetYear,
    remedialCountByStudentId,
  ]);

  const currentMonthExpectedTuitionByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    const currentMonth = Number(sheetMonth);
    for (const st of students) {
      const r = recordsByStudentId[st.id] ?? defaultRecordState();
      const dates = fullLessonDatesByStudentId[st.id] ?? [];
      const gradeFor = gradeForFeePricing(st, sheetYear, currentMonth, r.feePricingGrade);
      const flat = effectiveFlatLessonUnit(Number(r.lessonUnitPrice) || 0);
      out[st.id] = sumSlotTuitionHkd({ fullLessonDates: dates, flatUnit: flat, gradeFor, feeTierSettings });
    }
    return out;
  }, [
    students,
    recordsByStudentId,
    fullLessonDatesByStudentId,
    sheetYear,
    sheetMonth,
    feeTierSettings,
  ]);

  const priorExpectedTuitionSumByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    const currentMonth = Number(sheetMonth);
    const feeStartMonth = feeSystemStartMonth1to12(sheetYear);
    for (const st of students) {
      let sum = 0;
      const weekdays = weekdayTokensByStudentId[st.id] ?? [];
      const extras = extraEntriesByStudentId[st.id] ?? [];
      for (let m = feeStartMonth; m < currentMonth; m += 1) {
        const dates = collectSortedUniqueLessonDatesForMonth({
          year: sheetYear,
          month1to12: m,
          weekdays,
          extraEntries: extras,
        });
        const hist = historicalMonthFeeByStudentId[st.id]?.[m];
        const flat = effectiveFlatLessonUnit(Number(hist?.lessonUnitPrice) || 0);
        const gradeFor = gradeForFeePricing(st, sheetYear, m, hist?.feePricingGrade ?? "");
        sum += sumSlotTuitionHkd({ fullLessonDates: dates, flatUnit: flat, gradeFor, feeTierSettings });
      }
      out[st.id] = sum;
    }
    return out;
  }, [
    students,
    sheetYear,
    sheetMonth,
    weekdayTokensByStudentId,
    extraEntriesByStudentId,
    feeTierSettings,
    historicalMonthFeeByStudentId,
  ]);

  const balanceBeforeByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const st of students) {
      const priorExpectedTuition = Number(priorExpectedTuitionSumByStudentId[st.id] ?? 0) || 0;
      const submittedBefore = Number(submittedBeforeByStudentId[st.id] ?? 0) || 0;
      const opening =
        sheetYear === OPENING_BALANCE_AS_OF_YEAR
          ? Number(openingBalanceByStudentId[st.id] ?? 0) || 0
          : 0;
      out[st.id] = opening + priorExpectedTuition - submittedBefore;
    }
    return out;
  }, [
    students,
    priorExpectedTuitionSumByStudentId,
    submittedBeforeByStudentId,
    openingBalanceByStudentId,
    sheetYear,
  ]);

  const totalDueByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const st of students) {
      const thisMonth = Number(currentMonthExpectedTuitionByStudentId[st.id] ?? 0) || 0;
      const balanceBefore = Number(balanceBeforeByStudentId[st.id] ?? 0) || 0;
      out[st.id] = balanceBefore + thisMonth;
    }
    return out;
  }, [students, balanceBeforeByStudentId, currentMonthExpectedTuitionByStudentId]);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const monthlyArrearsRowsForDialog = useMemo(() => {
    if (!feeDetailDialog || feeDetailDialog.kind !== "arrears") return [];
    const st = studentById.get(feeDetailDialog.studentId);
    if (!st) return [];
    const currentMonth = Number(sheetMonth);
    return buildMonthlyArrearsRows({
      student: st,
      sheetYear,
      sheetMonth: currentMonth,
      openingBalance:
        sheetYear === OPENING_BALANCE_AS_OF_YEAR
          ? Number(openingBalanceByStudentId[st.id] ?? 0) || 0
          : 0,
      currentRecord: recordsByStudentId[st.id] ?? defaultRecordState(),
      historicalMonthFee: historicalMonthFeeByStudentId[st.id] ?? {},
      submittedByMonth: submittedByStudentMonth[st.id] ?? {},
      weekdays: weekdayTokensByStudentId[st.id] ?? [],
      extraEntries: extraEntriesByStudentId[st.id] ?? [],
      feeTierSettings,
    });
  }, [
    feeDetailDialog,
    studentById,
    sheetYear,
    sheetMonth,
    recordsByStudentId,
    openingBalanceByStudentId,
    historicalMonthFeeByStudentId,
    submittedByStudentMonth,
    weekdayTokensByStudentId,
    extraEntriesByStudentId,
    feeTierSettings,
  ]);

  const feeOutstandingSummary = useMemo(() => {
    const accumulate = (list: StudentRow[]) => {
      let outstanding = 0;
      let underpaidCount = 0;
      for (const st of list) {
        const r = recordsByStudentId[st.id] ?? defaultRecordState();
        const totalDue = Number(totalDueByStudentId[st.id] ?? 0) || 0;
        const paid = Number(r.submitted) || 0;
        const owe = totalDue - paid;
        if (owe > 0) {
          outstanding += owe;
          underpaidCount += 1;
        }
      }
      return { outstanding, underpaidCount };
    };
    return {
      filtered: accumulate(filteredSortedStudents),
      all: accumulate(sortedStudents),
    };
  }, [filteredSortedStudents, sortedStudents, recordsByStudentId, totalDueByStudentId]);

  useEffect(() => {
    if (students.length === 0) return;
    if (Object.keys(lessonRecordsByStudentId).length === 0) return;

    // Weekday uses student's current active rule (as of today).
    const todayIso = toHkIsoDateFromMs(Date.now());

    setRecordsByStudentId((prev) => {
      const next = { ...prev };
      for (const st of students) {
        if (!next[st.id]) next[st.id] = defaultRecordState();
        const records = lessonRecordsByStudentId[st.id] ?? [];
        const weekdays = getActiveWeekdays(records, todayIso);
        const finalWeekday =
          weekdays.length > 0
            ? weekdays.join("/")
            : next[st.id].weekday;
        const effectiveWeekdays = finalWeekday
          .split("/")
          .map((v) => v.trim())
          .filter(Boolean);
        const extraCount = extraEntryCountsByStudentId[st.id]?.current ?? 0;

        const baseExpected = effectiveWeekdays.reduce(
          (sum, wd) => sum + (weekdayCountsInSelectedMonth[wd] ?? 0),
          0,
        );
        next[st.id] = {
          ...next[st.id],
          weekday: finalWeekday,
          // Expected = regular lessons + extra lessons in this month.
          expected: baseExpected + extraCount,
        };
      }
      return next;
    });
  }, [
    students,
    lessonRecordsByStudentId,
    weekdayCountsInSelectedMonth,
    sheetMonth,
    sheetYear,
    extraEntryCountsByStudentId,
  ]);

  useEffect(() => {
    const tableEl = tableScrollRef.current;
    if (!tableEl) return;

    const updateMetrics = () => {
      setBottomScrollWidth(tableEl.scrollWidth);
      setBottomScrollClientWidth(tableEl.clientWidth);
      setSideScrollHeight(tableEl.scrollHeight);
      setSideScrollClientHeight(tableEl.clientHeight);
    };

    const onTableScroll = () => {
      setScrollLeft(tableEl.scrollLeft);
      setScrollTop(tableEl.scrollTop);
    };

    updateMetrics();
    setScrollLeft(tableEl.scrollLeft);
    setScrollTop(tableEl.scrollTop);
    tableEl.addEventListener("scroll", onTableScroll, { passive: true });
    const ro = new ResizeObserver(() => updateMetrics());
    ro.observe(tableEl);

    return () => {
      tableEl.removeEventListener("scroll", onTableScroll);
      ro.disconnect();
    };
  }, [sortedStudents.length, sheetYear, sheetMonth]);

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

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav />
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">Student Lesson Time & Tuition Record</h1>
            <p className="mt-1 text-sm text-blue-100">Student Lesson Time & Tuition Record</p>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-600">Year:</span>
                <span className="rounded-lg bg-[#1d76c2] px-2.5 py-1 text-sm font-semibold text-white">
                  {sheetYear}
                </span>
                <div className="ml-2 flex flex-wrap gap-1.5">
                  {availableYears.map((y) => {
                    const active = y === sheetYear;
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setSheetYear(y)}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          active
                            ? "bg-slate-800 text-white"
                            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
                <span className="ml-1 text-sm font-semibold text-slate-800">{MONTH_SHORT[sheetMonth - 1]}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MONTH_SHORT.map((label, i) => {
                  const m = i + 1;
                  const active = m === sheetMonth;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setSheetMonth(m)}
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        active
                          ? "bg-slate-800 text-white"
                          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="sticky top-0 z-50 -mx-2 mb-3 border-b border-slate-200 bg-white/95 px-2 pb-2 pt-1 backdrop-blur">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-700">
                      {sheetYear} / {MONTH_SHORT[sheetMonth - 1]} / Record Sheet
                    </div>
                    <div className="mt-0.5 max-w-[52rem] text-[11px] text-slate-500">
                      {`Total Due = opening balance (as of ${OPENING_BALANCE_AS_OF_EN_PHRASE}) + carry-forward since ${FEE_SYSTEM_START_EN_PHRASE} + this month's tuition. Legacy pre-system months are not back-filled month-by-month.`}
                      <span className="mt-0.5 block text-slate-600">
                        Tuition uses profile Grade + Sep 1 promotion inference (F1–F3 / F4–F6 tiers). Flat per-lesson or
                        locked pricing grade in DB still apply if previously saved.
                      </span>
                      <span className="mt-1.5 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-950">
                        <span className="font-semibold">留班（重讀同級）：</span>
                        若會跑 9/1 全表升班，可於 8/31 將學籍暫改為低一級（例 F.3→F.2），升班後確認檔案仍回到 F.3。
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void syncZohoSubmitted({
                        studentIds: filteredSortedStudents.map((s) => s.id),
                        idOnly: true,
                      })
                    }
                    disabled={syncingZoho}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path
                        transform="translate(0,-1.2)"
                        d="M4.08 11.86a5.5 5.5 0 019.27-3.59l-.94.94a.75.75 0 001.06 1.06l2.5-2.5a.75.75 0 000-1.06l-2.5-2.5a.75.75 0 00-1.06 1.06l.99.99a7 7 0 00-11.3 5.59.75.75 0 001.5 0z"
                      />
                      <path
                        transform="translate(0,1.2)"
                        d="M15.92 8.14a.75.75 0 00-1.5 0 5.5 5.5 0 01-9.27 3.59l.94-.94a.75.75 0 10-1.06-1.06l-2.5 2.5a.75.75 0 000 1.06l2.5 2.5a.75.75 0 001.06-1.06l-.99-.99a7 7 0 0011.3-5.59z"
                      />
                    </svg>
                    {syncingZoho ? "Syncing..." : "Sync Zoho Receipts"}
                  </button>
                </div>
                <div
                  className="mb-0 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2"
                  suppressHydrationWarning
                >
                <label className="min-w-[220px] flex-1">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Search (Phone / Name / ID)</span>
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="e.g. 9123 / Chan / 00123"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  />
                </label>
                <label className="min-w-[120px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Grade</span>
                  <select
                    value={gradeFilter}
                    onChange={(e) => setGradeFilter(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  >
                    <option value="all">All Grades</option>
                    <option value="F.1">F.1</option>
                    <option value="F.2">F.2</option>
                    <option value="F.3">F.3</option>
                    <option value="F.4">F.4</option>
                    <option value="F.5">F.5</option>
                    <option value="F.6">F.6</option>
                  </select>
                </label>
                <label className="min-w-[120px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Weekday</span>
                  <select
                    value={weekdayFilter}
                    onChange={(e) => setWeekdayFilter(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  >
                    <option value="all">All</option>
                    <option value="一">Mon</option>
                    <option value="二">Tue</option>
                    <option value="三">Wed</option>
                    <option value="四">Thu</option>
                    <option value="五">Fri</option>
                    <option value="六">Sat</option>
                    <option value="日">Sun</option>
                  </select>
                </label>
                <label className="min-w-[140px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Payment Status</span>
                  <select
                    value={paymentFilter}
                    onChange={(e) => setPaymentFilter(e.target.value as "all" | "underpaid" | "ok")}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  >
                    <option value="all">All</option>
                    <option value="underpaid">Underpaid</option>
                    <option value="ok">Expected Met</option>
                  </select>
                </label>
                <label className="min-w-[140px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Sessions（堂數）</span>
                  <select
                    value={sessionFilter}
                    onChange={(e) => setSessionFilter(e.target.value as "all" | "short" | "ok")}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  >
                    <option value="all">All</option>
                    <option value="short">未交齊（已上 &lt; 應堂）</option>
                    <option value="ok">已齊或無應堂</option>
                  </select>
                </label>
                <label className="min-w-[120px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Send Fee</span>
                  <select
                    value={sendFeeFilter}
                    onChange={(e) => setSendFeeFilter(e.target.value as "all" | "yes" | "no")}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  >
                    <option value="all">All</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setGradeFilter("all");
                    setWeekdayFilter("all");
                    setPaymentFilter("all");
                    setSessionFilter("all");
                    setSendFeeFilter("all");
                    setSearchText("");
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
                <div className="ml-auto flex flex-col items-end gap-1 text-xs text-slate-600 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-x-4 sm:gap-y-0">
                  <span>
                    Showing <span className="font-semibold text-slate-800">{filteredSortedStudents.length}</span> /{" "}
                    <span className="font-semibold text-slate-800">{sortedStudents.length}</span>
                  </span>
                  <span
                    className="text-right font-medium text-slate-800"
                    title="Sum of positive balance due (Total Due − Tuition Paid) across all rows"
                  >
                    Total owing{" "}
                    <span className="text-rose-700">${formatHkMoneyAmount(feeOutstandingSummary.all.outstanding)}</span>
                    <span className="text-slate-500"> ({feeOutstandingSummary.all.underpaidCount} students)</span>
                  </span>
                  {filteredSortedStudents.length !== sortedStudents.length ? (
                    <span className="text-right font-medium text-slate-800">
                      Filtered owing{" "}
                      <span className="text-rose-700">
                        ${formatHkMoneyAmount(feeOutstandingSummary.filtered.outstanding)}
                      </span>
                      <span className="text-slate-500"> ({feeOutstandingSummary.filtered.underpaidCount} students)</span>
                    </span>
                  ) : null}
                </div>
                </div>
              </div>
              {syncNotice ? (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {syncNotice}
                </div>
              ) : null}

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div className="flex">
                  <div
                    ref={tableScrollRef}
                    className="max-h-[70vh] flex-1 overflow-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    <table
                      className={`w-full border-collapse text-left text-sm ${
                        sheetYear === OPENING_BALANCE_AS_OF_YEAR ? "min-w-[2388px]" : "min-w-[2276px]"
                      }`}
                    >
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-200 text-xs font-bold tracking-wider text-slate-700">
                          <SortableHeader
                            label="ID"
                            columnKey="id"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thClassName="left-0 z-40"
                            thStyle={{ left: 0, minWidth: STICKY_ID_WIDTH }}
                          />
                          <SortableHeader
                            label="Name"
                            columnKey="name"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thClassName="z-40 align-middle"
                            thStyle={{ left: STICKY_ID_WIDTH, minWidth: STICKY_NAME_WIDTH }}
                            stackVertically
                          />
                          <SortableHeader
                            label="Grade"
                            columnKey="grade"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thClassName="z-40"
                            thStyle={{
                              left: STICKY_ID_WIDTH + STICKY_NAME_WIDTH,
                              minWidth: STICKY_GRADE_WIDTH,
                            }}
                          />
                          <th
                            className="sticky top-0 z-40 whitespace-nowrap border-r border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-bold tracking-wider text-slate-700"
                            style={{
                              left: STICKY_ID_WIDTH + STICKY_NAME_WIDTH + STICKY_GRADE_WIDTH,
                              minWidth: STICKY_PHONE_WIDTH,
                            }}
                          >
                            Phone Number
                          </th>
                          <SortableHeader
                            label="Weekday"
                            columnKey="weekday"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thStyle={{ minWidth: WEEKDAY_COL_WIDTH }}
                          />
                          <SortableHeader
                            label="Tuition Paid"
                            columnKey="submitted"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thStyle={{ minWidth: TUITION_COL_WIDTH }}
                          />
                          <th
                            className="sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-2 py-3 text-left text-xs font-bold tracking-wider text-slate-700"
                            style={{ minWidth: AMOUNT_OWING_COL_WIDTH }}
                            title="Balance due = Total Due − Tuition Paid. Positive = still owes; negative = overpaid. Click a cell for details."
                          >
                            <span className="block">Balance Due</span>
                            <span className="block text-[10px] font-semibold text-slate-500">Due − Paid</span>
                          </th>
                          {Array.from({ length: L_COUNT }, (_, i) => (
                            <th
                              key={i}
                              className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-2 py-3 text-center text-[11px]"
                              style={{ minWidth: L_COL_WIDTH }}
                            >
                              L{i + 1}
                            </th>
                          ))}
                          <th
                            className="sticky top-0 z-30 bg-slate-50 px-2 py-3 text-left"
                            style={{ minWidth: MAKEUP_COL_WIDTH }}
                            title="與課表 Makeup Count 相同；只計上一個曆月未打勾補堂（例：5 月只計 4 月）"
                          >
                            <span className="block text-xs font-bold tracking-wider text-slate-700">Makeup</span>
                            <span className="block text-[10px] font-semibold leading-tight text-slate-500">
                              按格睇日期
                            </span>
                          </th>
                          <SortableHeader
                            label="Total Due"
                            sublabel="Gross (prev + month)"
                            columnKey="expected"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thStyle={{ minWidth: TUITION_COL_WIDTH }}
                          />
                          {sheetYear === OPENING_BALANCE_AS_OF_YEAR ? (
                            <th
                              className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-2 py-3 text-left text-xs font-bold tracking-wider text-slate-700"
                              style={{ minWidth: OPENING_COL_WIDTH }}
                              title={`Balance as of ${OPENING_BALANCE_AS_OF_EN_PHRASE}: positive = still owing; negative = overpaid (credit). Legacy Excel period is locked into this column (no month-by-month back-fill).`}
                            >
                              <span className="block whitespace-nowrap">Opening balance</span>
                              <span className="block text-[10px] font-semibold text-slate-500">
                                As of {OPENING_BALANCE_AS_OF_EN_PHRASE}
                              </span>
                            </th>
                          ) : null}
                          <th className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-4 py-3 text-left">Remarks</th>
                          <th
                            className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-4 py-3 text-left"
                            style={{ minWidth: SEND_FEE_COL_WIDTH }}
                          >
                            Send Fee
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredSortedStudents.map((st, index) => {
                          const r = recordsByStudentId[st.id] ?? defaultRecordState();
                          const arrearsDue = balanceBeforeByStudentId[st.id] ?? 0;
                          const totalDue = totalDueByStudentId[st.id] ?? 0;
                          const underPaid = r.submitted < totalDue;
                          const balanceCarryForward = totalDue - r.submitted;
                          const thisMonthDatedSlotCount = (fullLessonDatesByStudentId[st.id] ?? []).filter((d) =>
                            String(d ?? "").trim(),
                          ).length;
                          const lessonDatesSerialized = (lessonDatesByStudentId[st.id] ?? []).join("|");
                          const prev = index > 0 ? filteredSortedStudents[index - 1] : null;
                          const showGradeSeparatorTop =
                            prev != null && prev.grade.trim() !== st.grade.trim();
                          return (
                            <StudentFeeRow
                              key={st.id}
                              student={st}
                              record={r}
                              underPaid={underPaid}
                              arrearsDue={arrearsDue}
                              totalDue={totalDue}
                              balanceCarryForward={balanceCarryForward}
                              lessonDatesSerialized={lessonDatesSerialized}
                              thisMonthDatedSlotCount={thisMonthDatedSlotCount}
                              makeupLiveCount={remedialCountByStudentId[st.id] ?? 0}
                              makeupDbOnly={false}
                              remedialCountDb={remedialCountByStudentId[st.id] ?? 0}
                              showGradeSeparatorTop={showGradeSeparatorTop}
                              showOpeningEditor={sheetYear === OPENING_BALANCE_AS_OF_YEAR}
                              openingBalance={openingBalanceByStudentId[st.id] ?? 0}
                              onOpeningBalanceChange={onOpeningBalanceChange}
                              onSubmittedChange={onSubmittedChange}
                              onRemarksChange={onRemarksChange}
                              onSendFeeChange={onSendFeeChange}
                              currentMonthExpectedMoney={currentMonthExpectedTuitionByStudentId[st.id] ?? 0}
                              feeTierSettings={feeTierSettings}
                              onFeeDetailOpen={onFeeDetailOpen}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {sideScrollHeight > sideScrollClientHeight ? (
                    <div className="border-l border-slate-200 bg-slate-50 px-2 py-2">
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

              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-sm font-bold text-amber-800">* Please confirm what L1-L9 each represent (for example: date / session / required sessions).</div>
                <div className="mt-2 text-sm text-amber-900">* After confirmation, I can connect these cells to the auto-calculation logic for lesson time and tuition.</div>
              </div>

              <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50/90 p-3 text-[13.2px]">
                <summary className="cursor-pointer select-none font-semibold text-slate-800">
                  Lesson tiers (F1–3 / F4–6)
                </summary>
                <p className="mt-2 text-[12.1px] leading-snug text-slate-600">
                  <span className="font-semibold">Save</span> stores in this browser; Supabase syncs too if{" "}
                  <code className="rounded bg-slate-200/80 px-0.5">app_student_fee_tier_settings</code> exists.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">
                      F1-F3 (Normal)
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={feeTierDraft.f_low_tier_1_8}
                      onChange={(e) =>
                        setFeeTierDraft((d) => ({
                          ...d,
                          f_low_tier_1_8: Number(e.target.value) || 0,
                        }))
                      }
                      className="w-[4rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[13.2px] tabular-nums"
                      suppressHydrationWarning
                    />
                  </label>
                  <label className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">
                      F1-F3 (Discount)
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={feeTierDraft.f_low_tier_9_plus}
                      onChange={(e) =>
                        setFeeTierDraft((d) => ({
                          ...d,
                          f_low_tier_9_plus: Number(e.target.value) || 0,
                        }))
                      }
                      className="w-[4rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[13.2px] tabular-nums"
                      suppressHydrationWarning
                    />
                  </label>
                  <label className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">
                      F4-F6 (Normal)
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={feeTierDraft.f_high_tier_1_8}
                      onChange={(e) =>
                        setFeeTierDraft((d) => ({
                          ...d,
                          f_high_tier_1_8: Number(e.target.value) || 0,
                        }))
                      }
                      className="w-[4rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[13.2px] tabular-nums"
                      suppressHydrationWarning
                    />
                  </label>
                  <label className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">
                      F4-F6 (Discount)
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={feeTierDraft.f_high_tier_9_plus}
                      onChange={(e) =>
                        setFeeTierDraft((d) => ({
                          ...d,
                          f_high_tier_9_plus: Number(e.target.value) || 0,
                        }))
                      }
                      className="w-[4rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[13.2px] tabular-nums"
                      suppressHydrationWarning
                    />
                  </label>
                  <label className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 whitespace-nowrap text-[12.1px] font-semibold text-slate-500">
                      Discount Split
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={feeTierDraft.lesson_tier_break_after}
                      onChange={(e) =>
                        setFeeTierDraft((d) => ({
                          ...d,
                          lesson_tier_break_after: Math.min(24, Math.max(1, Math.floor(Number(e.target.value) || 8))),
                        }))
                      }
                      className="w-11 shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[14.52px] tabular-nums"
                      suppressHydrationWarning
                    />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveFeeTierSettings()}
                    className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-[13.2px] font-semibold text-white shadow-sm hover:bg-[#1663a3]"
                  >
                    Save
                  </button>
                  {feeTierSaveMsg ? (
                    <span className="text-[12.1px] font-medium text-slate-700">{feeTierSaveMsg}</span>
                  ) : null}
                </div>
              </details>
            </div>
          </div>
        </div>

            {feeDetailDialog ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onClick={() => setFeeDetailDialog(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fee-detail-title"
            className="relative max-h-[85vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h2 id="fee-detail-title" className="pr-6 text-sm font-bold leading-snug text-slate-900">
                {feeDetailDialog.kind === "arrears"
                  ? feeDetailDialog.title
                  : makeupDialogTitle(
                      feeDetailDialog.studentId,
                      students,
                      feeDialogMakeupDetail.liveCount > 0
                        ? feeDialogMakeupDetail.liveCount
                        : (remedialCountByStudentId[feeDetailDialog.studentId] ?? 0),
                      remedialCountByStudentId[feeDetailDialog.studentId] ?? 0,
                    )}
              </h2>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="關閉"
                onClick={() => setFeeDetailDialog(null)}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-4 py-3 text-sm leading-relaxed text-slate-800">
              {feeDetailDialog.kind === "arrears" ? (
                <FeeArrearsDetailTable
                  rows={monthlyArrearsRowsForDialog}
                  totalOutstanding={
                    (Number(totalDueByStudentId[feeDetailDialog.studentId] ?? 0) || 0) -
                    (Number(recordsByStudentId[feeDetailDialog.studentId]?.submitted ?? 0) || 0)
                  }
                  balanceDueRemarks={recordsByStudentId[feeDetailDialog.studentId]?.balanceDueRemarks ?? ""}
                  onBalanceDueRemarksChange={(value) =>
                    onBalanceDueRemarksChange(feeDetailDialog.studentId, value)
                  }
                />
              ) : (
                <FeeMakeupDetailPanel
                  dates={feeDialogMakeupDetail.dates}
                  dbOnly={feeDialogMakeupDetail.dbOnly}
                  remedialCountDb={remedialCountByStudentId[feeDetailDialog.studentId] ?? 0}
                  makeupRemarks={recordsByStudentId[feeDetailDialog.studentId]?.makeupRemarks ?? ""}
                  onMakeupRemarksChange={(value) => onMakeupRemarksChange(feeDetailDialog.studentId, value)}
                />
              )}
            </div>
          </div>
        </div>
            ) : null}
      </div>
    </div>
  );
}

type SortableHeaderProps = {
  label: string;
  sublabel?: string;
  columnKey: SortKey;
  sortConfig: SortConfig;
  setSortConfig: (config: SortConfig) => void;
  thClassName?: string;
  thStyle?: React.CSSProperties;
  /** Narrow sticky columns: stack title + sort, allow wrap. */
  stackVertically?: boolean;
};

type StudentFeeRowProps = {
  student: StudentRow;
  record: RecordState;
  underPaid: boolean;
  arrearsDue: number;
  totalDue: number;
  balanceCarryForward: number;
  lessonDatesSerialized: string;
  makeupLiveCount: number;
  makeupDbOnly: boolean;
  remedialCountDb: number;
  /** Add a stronger top border when grade changes from previous row. */
  showGradeSeparatorTop: boolean;
  showOpeningEditor: boolean;
  openingBalance: number;
  onOpeningBalanceChange: (studentId: string, value: number) => void;
  onSubmittedChange: (studentId: string, submitted: number) => void;
  onRemarksChange: (studentId: string, remarks: string) => void;
  onSendFeeChange: (studentId: string, sendFee: boolean) => void;
  /** 本月按階梯／劃一計出嘅應收港幣（同 Total Due − Prev 一致）。 */
  currentMonthExpectedMoney: number;
  /** 本月課表有日期嘅檔位數（用於 $xx(N堂) 顯示）。 */
  thisMonthDatedSlotCount: number;
  feeTierSettings: StudentFeeTierSettings;
  onFeeDetailOpen: (dialog: { kind: "arrears"; studentId: string; title: string } | { kind: "makeup"; studentId: string }) => void;
};

const StudentFeeRow = memo(function StudentFeeRow({
  student,
  record,
  underPaid,
  arrearsDue,
  totalDue,
  balanceCarryForward,
  lessonDatesSerialized,
  makeupLiveCount,
  makeupDbOnly,
  remedialCountDb,
  showGradeSeparatorTop,
  showOpeningEditor,
  openingBalance,
  onOpeningBalanceChange,
  onSubmittedChange,
  onRemarksChange,
  onSendFeeChange,
  currentMonthExpectedMoney,
  thisMonthDatedSlotCount,
  feeTierSettings,
  onFeeDetailOpen,
}: StudentFeeRowProps) {
  const lessonDates = lessonDatesSerialized ? lessonDatesSerialized.split("|") : [];
  const studentIdDisplay = normalizeStudentId(student.id);
  const nameZh = (student.name_zh ?? "").trim();
  const nameNick = (student.nickname_en ?? "").trim();
  const nameEn = (student.name_en ?? "").trim();
  const nameSecondary = nameNick || nameEn;
  const hasAnyName = Boolean(nameZh || nameNick || nameEn);
  const studentLabel = formatStudentDisplayNameOrEmpty(
    {
      id: student.id,
      name_zh: student.name_zh,
      name_en: student.name_en,
      nickname_en: student.nickname_en,
    },
    "full",
  );
  const makeupDisplayN = makeupLiveCount > 0 ? makeupLiveCount : remedialCountDb;

  const flatUnit = effectiveFlatLessonUnit(Number(record.lessonUnitPrice) || 0);
  const paidLessonHintCount = tuitionPaidLessonHintCount({
    submitted: record.submitted,
    flatUnit,
    monthDatedSlotCount: thisMonthDatedSlotCount,
    expectedSessions: record.expected,
  });

  const gradeForOpening = inferGradeAtSheetEnd(
    student.grade,
    OPENING_BALANCE_AS_OF_YEAR,
    OPENING_BALANCE_AS_OF_MONTH,
  );
  const openingLessonHintCount = openingBalanceLessonHintCount({
    openingBalance,
    gradeForPricing: gradeForOpening,
    feeTierSettings,
  });

  return (
    <tr
      className={`divide-x divide-slate-100 ${
        underPaid ? "bg-amber-50 hover:bg-amber-100" : "bg-white hover:bg-slate-50"
      } ${showGradeSeparatorTop ? "border-t-2 border-slate-400" : ""}`}
    >
      <td
        className="sticky left-0 z-30 whitespace-nowrap bg-inherit px-4 py-4 text-sm text-slate-700"
        style={{ left: 0, minWidth: STICKY_ID_WIDTH }}
      >
        <Link
          href={`/students/${encodeURIComponent(studentIdDisplay)}/lessons`}
          className="font-medium text-[#1d76c2] hover:underline"
        >
          {studentIdDisplay}
        </Link>
      </td>
      <td
        className="sticky z-30 min-w-0 bg-inherit px-1.5 py-3 text-left text-xs text-slate-700 align-middle"
        style={{ left: STICKY_ID_WIDTH, minWidth: STICKY_NAME_WIDTH, maxWidth: STICKY_NAME_WIDTH }}
      >
        {!hasAnyName ? (
          "—"
        ) : (
          <div
            className="line-clamp-2 min-w-0 max-w-full break-words text-left text-xs leading-snug"
            title={studentLabel}
          >
            {nameZh && nameSecondary ? (
              <>
                <span className="font-medium text-slate-800">{nameZh}</span>
                <br />
                <span className="font-medium text-slate-600">{nameSecondary}</span>
              </>
            ) : (
              <span className="font-medium text-slate-800">{nameZh || nameSecondary}</span>
            )}
          </div>
        )}
      </td>
      <td
        className="sticky z-30 whitespace-nowrap bg-inherit px-4 py-4 text-sm text-slate-700"
        style={{ left: STICKY_ID_WIDTH + STICKY_NAME_WIDTH, minWidth: STICKY_GRADE_WIDTH }}
      >
        {formatGradeDisplay(student.grade) || "—"}
      </td>
      <td
        className="sticky z-30 whitespace-nowrap border-r border-slate-200 bg-inherit px-4 py-4 text-sm text-slate-700"
        style={{
          left: STICKY_ID_WIDTH + STICKY_NAME_WIDTH + STICKY_GRADE_WIDTH,
          minWidth: STICKY_PHONE_WIDTH,
        }}
      >
        {student.student_phone ? (
          <span className="inline-block whitespace-pre-line break-all leading-5 [display:-webkit-box] [WebkitBoxOrient:vertical] [WebkitLineClamp:2]">
            {formatPhoneNumberTwoLines(student.student_phone)}
          </span>
        ) : (
          "—"
        )}
      </td>

      <td className="px-2 py-3 text-center">
        <div className="text-center text-xs font-medium text-slate-800" style={{ width: WEEKDAY_COL_WIDTH }}>
          {(record.weekday
            ? record.weekday
                .split("/")
                .map((wd) => HK_WEEKDAY_CN_TO_EN[wd] ?? wd)
                .join("/")
            : "") || "—"}
        </div>
      </td>
      <td className="px-2 py-3 text-center">
        <div className="mx-auto flex max-w-[9rem] flex-col items-center gap-0.5">
          <input
            type="number"
            inputMode="decimal"
            value={record.submitted}
            title="本月已繳學費（港幣）：手填或 Zoho；尚欠＝應收總額 − 此欄"
            onChange={(e) => {
              const num = Number(e.target.value);
              onSubmittedChange(student.id, Number.isFinite(num) ? num : 0);
            }}
            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
            style={{ width: TUITION_COL_WIDTH - 32 }}
          />
          {record.submitted > 0 ? (
            <span className="text-[9px] font-medium tabular-nums text-slate-500">
              {paidLessonHintCount != null
                ? formatHkdWithLessons(record.submitted, paidLessonHintCount)
                : `$${formatHkMoneyAmount(record.submitted)}`}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-3 text-center align-middle">
        <button
          type="button"
          className={`mx-auto w-full max-w-[7.25rem] whitespace-normal rounded border border-transparent px-1 py-1 transition hover:border-slate-200 hover:bg-slate-50 ${
            balanceCarryForward > 0
              ? "text-rose-700"
              : balanceCarryForward < 0
                ? "text-emerald-700"
                : "text-slate-600"
          }`}
          onClick={() =>
            onFeeDetailOpen({
              kind: "arrears",
              studentId: student.id,
              title: `${studentLabel}（學號 ${studentIdDisplay}）– 欠款明細`,
            })
          }
        >
          <span className="block text-sm font-semibold tabular-nums leading-tight">
            {formatHkdWithLessons(balanceCarryForward, thisMonthDatedSlotCount)}
          </span>
          <span className="mt-0.5 block text-[9px] font-normal text-slate-500">查看明細</span>
        </button>
      </td>
      {Array.from({ length: L_COUNT }, (_, i) => (
        <td key={i} className="px-2 py-3 text-center">
          <div
            className="h-7 rounded bg-slate-50 px-1 text-center text-[11px] leading-6 text-slate-800"
            style={{ width: L_COL_WIDTH - 8 }}
          >
            {lessonDates[i] ?? ""}
          </div>
        </td>
      ))}

      <td className="px-2 py-3 text-center align-top">
        <button
          type="button"
          className="mx-auto flex w-full max-w-[5.5rem] flex-col items-center rounded border border-transparent px-1 py-1 transition hover:border-slate-200 hover:bg-slate-50"
          onClick={() =>
            onFeeDetailOpen({
              kind: "makeup",
              studentId: student.id,
            })
          }
        >
          <span className="text-sm font-semibold tabular-nums text-slate-800">{makeupDisplayN}</span>
          <span className="mt-0.5 text-[9px] font-normal text-slate-500">按此睇日期</span>
        </button>
      </td>

      <td className="px-2 py-3 text-center">
        <div
          className="mx-auto max-w-[9rem] whitespace-normal text-center text-xs font-semibold text-slate-800 leading-snug"
          title={`Total Due＝帶入結餘 + 本月應收（未扣已繳）；括號 N 堂＝本月有檔期堂數（Total 含結餘時與 N 堂唔一定同價對齊）`}
        >
          <div className="tabular-nums">{formatHkdWithLessons(totalDue, thisMonthDatedSlotCount)}</div>
          <div className="mt-0.5 text-[10px] font-medium text-slate-500">
            Prev ${formatHkMoneyAmount(arrearsDue)} + 本月{" "}
            {formatHkdWithLessons(currentMonthExpectedMoney, thisMonthDatedSlotCount)}
          </div>
        </div>
      </td>

      {showOpeningEditor ? (
        <td className="px-2 py-3 text-center align-middle">
          <div className="mx-auto flex max-w-[9rem] flex-col items-center gap-0.5">
            <input
              type="number"
              inputMode="decimal"
              value={openingBalance}
              onChange={(e) => {
                const num = Number(e.target.value);
                onOpeningBalanceChange(student.id, Number.isFinite(num) ? num : 0);
              }}
              title={`Positive = still owing as of ${OPENING_BALANCE_AS_OF_EN_PHRASE}; negative = credit. Bracket 堂 uses ${formatGradeDisplay(gradeForOpening) || gradeForOpening} tier (1–8 lesson rate).`}
              className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
              style={{ width: OPENING_COL_WIDTH - 32 }}
              suppressHydrationWarning
            />
            {Math.abs(openingBalance) >= 0.005 ? (
              <span className="text-[9px] font-medium tabular-nums text-slate-500">
                {openingLessonHintCount != null
                  ? formatHkdWithLessons(openingBalance, openingLessonHintCount)
                  : `$${formatHkMoneyAmount(openingBalance)}`}
              </span>
            ) : null}
          </div>
        </td>
      ) : null}

      <td className="px-2 py-3 align-top">
        <textarea
          value={record.remarks}
          onChange={(e) => onRemarksChange(student.id, e.target.value)}
          rows={4}
          title="Enter 換行；可拖右下角拉高（與 Excel 多行備註相近）"
          spellCheck={false}
          className="min-h-[5.5rem] w-56 max-w-[min(18rem,36vw)] resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-snug text-slate-800 outline-none transition focus:border-[#1d76c2] whitespace-pre-wrap break-words"
        />
      </td>

      <td className="px-2 py-3 text-center">
        <input
          type="checkbox"
          checked={record.sendFee}
          onChange={(e) => onSendFeeChange(student.id, e.target.checked)}
          className="h-4 w-4 accent-[#1d76c2]"
          aria-label={`${studentIdDisplay} send fee`}
        />
      </td>
    </tr>
  );
});

function SortableHeader({
  label,
  sublabel,
  columnKey,
  sortConfig,
  setSortConfig,
  thClassName,
  thStyle,
  stackVertically = false,
}: SortableHeaderProps) {
  const selectedDirection = sortConfig?.key === columnKey ? sortConfig.direction : "";

  return (
    <th
      style={thStyle}
      className={[
        "sticky top-0 z-20 bg-slate-50 text-left text-xs font-bold tracking-wider text-slate-700",
        stackVertically
          ? "whitespace-normal px-1.5 py-2"
          : "whitespace-nowrap px-4 py-3",
        thClassName ?? "",
      ].join(" ")}
    >
      <div
        className={
          stackVertically ? "flex min-w-0 flex-col gap-1" : "flex items-start gap-1.5"
        }
      >
        <span className={`min-w-0 leading-tight ${stackVertically ? "block" : ""}`}>
          <span className={`block ${stackVertically ? "" : "whitespace-nowrap"}`}>{label}</span>
          {sublabel ? (
            <span
              className={`block font-semibold text-slate-500 ${
                stackVertically ? "text-xs" : "text-[10px]"
              }`}
            >
              {sublabel}
            </span>
          ) : null}
        </span>
        <select
          aria-label={`Sort by ${label}`}
          suppressHydrationWarning
          value={selectedDirection}
          onChange={(event) => {
            const direction = event.target.value as SortDirection | "";
            if (!direction) {
              setSortConfig(null);
              return;
            }
            setSortConfig({ key: columnKey, direction });
          }}
          className={`rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-700 ${
            stackVertically ? "w-full min-w-0 shrink-0" : ""
          }`}
        >
          <option value="">▽</option>
          <option value="asc">↑</option>
          <option value="desc">↓</option>
        </select>
      </div>
    </th>
  );
}

