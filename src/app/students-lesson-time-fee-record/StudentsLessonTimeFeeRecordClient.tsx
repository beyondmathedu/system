"use client";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import AppTopNav from "@/components/AppTopNav";
import { VirtualTableSpacerRow } from "@/components/VirtualTableSpacerRow";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import {
  FEE_OPENING_BALANCE_AS_OF_MONTH,
  FEE_OPENING_BALANCE_AS_OF_YEAR,
  upsertStudentFeeOpeningBalance,
  writeFeeOpeningBalanceToLocal,
} from "@/lib/studentFeeOpeningBalance";
import {
  emptyFeeBalanceAdjustment,
  upsertStudentFeeBalanceAdjustment,
  writeFeeBalanceAdjustmentToLocal,
  type StudentFeeBalanceAdjustment,
} from "@/lib/studentFeeBalanceAdjustment";
import {
  upsertStudentMonthlyFeeRecord,
  type StudentLesson2026State,
} from "@/lib/studentLessonStorage";
import { readYmdParts } from "@/lib/intlFormatParts";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { normalizeStudentId } from "@/lib/studentId";
import { formatGradeDisplay, gradeRank, normalizeGradeCode } from "@/lib/grade";
import {
  inferGradeAtSheetEnd,
  isLowerFeeTier,
  sumSlotTuitionHkdFromDates,
} from "@/lib/studentFeePricingGrade";
import {
  DEFAULT_FEE_TIER_BUNDLE,
  resolveFeeTierSettingsForStudent,
  saveStudentFeeTierSettings,
  type StudentFeeTierBundle,
  type StudentFeeTierSettings,
} from "@/lib/studentFeeTierSettings";
import {
  getPriorMonthMakeupWindow,
  getUpcomingUntickedDates,
  type Lesson2026Record,
  type Lesson2026State,
} from "@/lib/lesson2026Summary";
import { getActiveScheduleRulesForDate } from "@/lib/lessonScheduleVersions";
import {
  collectAttendedBillableLessonDatesForMonth,
  collectBillableLessonDatesForMonth,
  countAttendedBillableLessonsInMonth,
  isoYmdToMonthDay,
  normalizeFeeLessonRecords,
  toYearLessonStateFromClient,
} from "@/lib/feeRecordLessonDates";
import {
  hydrateFeeRecordBootstrap,
  type FeeRecordBootstrapApiBody,
} from "@/lib/feeRecordBootstrapHydrate";
import { notifyScheduleCachesStale, revalidateScheduleCachesNow } from "@/lib/scheduleCacheClient";
import {
  isStudentHiddenForFeeSheetMonthFromPeriods,
  makeStudentInactiveDateCheckerFromPeriods,
} from "@/lib/studentVisibility";
import {
  availableLessonYears,
} from "@/lib/lessonCalendar";
import {
  LESSON_SYSTEM_START_MONTH,
  LESSON_SYSTEM_START_YEAR,
} from "@/lib/lessonSystemStart";
import { useCustomScrollbars } from "@/lib/useCustomScrollbars";

type StudentRow = {
  id: string;
  name_zh: string;
  name_en: string;
  nickname_en: string;
  grade: string;
  student_phone: string;
  created_at: string;
};

const MIN_L_COLUMN_COUNT = 9;
const OPENING_BALANCE_AS_OF_YEAR = FEE_OPENING_BALANCE_AS_OF_YEAR;
const OPENING_BALANCE_AS_OF_MONTH = FEE_OPENING_BALANCE_AS_OF_MONTH; // balance as of end of 2026/04

const STICKY_ID_WIDTH = 88;
/** Narrow sticky column; long names wrap to 2 lines (see StudentFeeRow). */
const STICKY_NAME_WIDTH = 76;
const STICKY_GRADE_WIDTH = 84;
const STICKY_PHONE_WIDTH = 132;
const WEEKDAY_COL_WIDTH = 86;
const TUITION_COL_WIDTH = 96;
const AMOUNT_OWING_COL_WIDTH = 92;
const OPENING_COL_WIDTH = 112;
const L_COL_WIDTH = 72;
const MAKEUP_COL_WIDTH = 104;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** English copy for opening-balance column / tooltips (calendar month-end). */
const OPENING_BALANCE_AS_OF_EN_PHRASE = `end of ${MONTH_SHORT[OPENING_BALANCE_AS_OF_MONTH - 1]} ${OPENING_BALANCE_AS_OF_YEAR}`;
const FEE_SYSTEM_START_EN_PHRASE = `${MONTH_SHORT[LESSON_SYSTEM_START_MONTH - 1]} ${LESSON_SYSTEM_START_YEAR}`;
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

function feeRecordToHkIsoDateFromMs(msOrIso: number | string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(msOrIso));

  const { y, m, d } = readYmdParts(parts);
  return `${y}-${m}-${d}`;
}

function getActiveWeekdaysForFeeRecord(records: LessonRecord[], dateIso: string) {
  if (!records.length) return [] as string[];
  const normalized = records
    .map((r) => {
      const rr = r as unknown as Record<string, unknown>;
      const weekday = String(rr.weekday ?? rr.week_day ?? rr.weekDay ?? rr.Weekday ?? "") || "";

      const effectiveDate =
        (typeof rr.effectiveDate === "string"
          ? rr.effectiveDate
          : typeof rr.effective_date === "string"
            ? rr.effective_date
            : undefined) ??
        feeRecordToHkIsoDateFromMs(
          typeof rr.createdAt === "number"
            ? rr.createdAt
            : typeof rr.created_at === "number"
              ? rr.created_at
              : Date.now(),
        );

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
  const weekdays = [...new Set(activeRules.map((r) => r.weekday).filter(Boolean))];
  weekdays.sort((a, b) => (WEEKDAY_ORDER[a] ?? 99) - (WEEKDAY_ORDER[b] ?? 99));
  return weekdays;
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

/** 已繳欄括號堂數：Zoho quantity；再否則 L 檔有日期堂數；再否則 Expected。 */
function tuitionPaidLessonHintCount(params: {
  submitted: number;
  submittedLessonCount?: number | null;
  monthDatedSlotCount: number;
  expectedSessions: number;
}): number | null {
  const { submitted, submittedLessonCount, monthDatedSlotCount, expectedSessions } = params;
  if (submitted <= 0) return null;
  const zohoQty = submittedLessonCount == null ? NaN : Number(submittedLessonCount);
  if (Number.isFinite(zohoQty) && zohoQty > 0) return Math.round(zohoQty);
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

/** 欠款明細表：期初結餘（如有）＋ 系統起算月至當前表月份，每月應繳／已繳／尚欠＋調整／優惠。 */
function buildMonthlyArrearsRows(params: {
  student: StudentRow;
  sheetYear: number;
  sheetMonth: number;
  openingBalance: number;
  balanceAdjustment?: StudentFeeBalanceAdjustment;
  currentRecord: RecordState;
  historicalMonthFee: Partial<Record<number, { lessonUnitPrice: number; feePricingGrade: string }>>;
  submittedByMonth: Partial<Record<number, number>>;
  lessonRecords: unknown;
  yearState: StudentLesson2026State | undefined;
  legacyWeekdays: string[];
  feeTierBundle: StudentFeeTierBundle;
  isMonthInactiveForFee?: (month1to12: number) => boolean;
  isDateInactive?: (dateIso: string) => boolean;
}): MonthlyArrearsRow[] {
  const {
    student,
    sheetYear,
    sheetMonth,
    openingBalance,
    balanceAdjustment,
    currentRecord,
    historicalMonthFee,
    submittedByMonth,
    lessonRecords,
    yearState,
    legacyWeekdays,
    feeTierBundle,
    isMonthInactiveForFee,
    isDateInactive,
  } = params;
  const records = normalizeFeeLessonRecords(lessonRecords);
  const state = toYearLessonStateFromClient(yearState);
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
    const paid =
      m === sheetMonth ? Number(currentRecord.submitted) || 0 : Number(submittedByMonth[m] ?? 0) || 0;
    if (isMonthInactiveForFee?.(m)) {
      rows.push({
        key: `${sheetYear}-${m}`,
        monthLabel: formatSheetMonthZh(sheetYear, m),
        expected: 0,
        lessonCount: 0,
        paid,
        outstanding: -paid,
      });
      continue;
    }
    const dates = collectBillableLessonDatesForMonth({
      records,
      state,
      year: sheetYear,
      month1to12: m,
      legacyWeekdays,
      isDateInactive,
    });
    const lessonCount = countDatedLessonSlots(dates);
    const hist = historicalMonthFee[m];
    const gradeFor = gradeForFeePricing(
      student,
      sheetYear,
      m,
      m === sheetMonth ? currentRecord.feePricingGrade : String(hist?.feePricingGrade ?? ""),
    );
    const tier = resolveFeeTierSettingsForStudent(feeTierBundle, student.id, sheetYear, m);
    const expected = sumSlotTuitionHkdFromDates({
      fullLessonDates: dates,
      gradeFor,
      feeTierSettings: tier,
    });
    rows.push({
      key: `${sheetYear}-${m}`,
      monthLabel: formatSheetMonthZh(sheetYear, m),
      expected,
      lessonCount,
      paid,
      outstanding: expected - paid,
    });
  }
  const adjAmount = Number(balanceAdjustment?.amount) || 0;
  const adjReason = String(balanceAdjustment?.reason ?? "").trim();
  if (Math.abs(adjAmount) >= 0.005 || adjReason) {
    rows.push({
      key: "adjustment",
      monthLabel: adjReason || "調整／優惠",
      expected: adjAmount,
      lessonCount: 0,
      paid: 0,
      outstanding: adjAmount,
      isLegacyOpening: true,
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

function resolveMakeupDisplayCount(
  liveCount: number,
  remedialCountDb: number,
  hasLessonPayload: boolean,
): number {
  return hasLessonPayload ? liveCount : remedialCountDb;
}

function makeupDialogTitle(
  studentId: string,
  students: StudentRow[],
  liveCount: number,
  remedialCountDb: number,
  hasLessonPayload: boolean,
): string {
  const st = students.find((s) => s.id === studentId);
  const studentLabel = st
    ? formatStudentDisplayNameOrEmpty(
        { id: st.id, name_zh: st.name_zh, name_en: st.name_en, nickname_en: st.nickname_en },
        "full",
      )
    : studentId;
  const count = resolveMakeupDisplayCount(liveCount, remedialCountDb, hasLessonPayload);
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

function isSpecialArrearsRow(row: MonthlyArrearsRow): boolean {
  // 期初結餘仍在「只看尚欠」顯示；二人同行／調整只在「全部月份」出現。
  return row.key === "opening";
}

function isOpenArrearsRow(row: MonthlyArrearsRow): boolean {
  if (row.key === "adjustment") return false;
  return Math.abs(row.outstanding) >= 0.005 || isSpecialArrearsRow(row);
}

function arrearsRowYearLabel(row: MonthlyArrearsRow): string | null {
  const fromKey = row.key.match(/^(\d{4})-/);
  if (fromKey) return `${fromKey[1]} 年`;
  const fromLabel = row.monthLabel.match(/^(\d{4})\s*年/);
  if (fromLabel) return `${fromLabel[1]} 年`;
  return null;
}

const PAIR_DISCOUNT_PRESET_HKD = 300;
const PAIR_DISCOUNT_PRESET_REASON = "二人同行";

function FeeArrearsDetailTable({
  rows,
  totalOutstanding,
  balanceDueRemarks,
  onBalanceDueRemarksChange,
  adjustmentAmount,
  adjustmentReason,
  onAdjustmentChange,
}: {
  rows: MonthlyArrearsRow[];
  totalOutstanding: number;
  balanceDueRemarks: string;
  onBalanceDueRemarksChange: (value: string) => void;
  adjustmentAmount: number;
  adjustmentReason: string;
  onAdjustmentChange: (next: StudentFeeBalanceAdjustment) => void;
}) {
  const [showAllMonths, setShowAllMonths] = useState(false);

  const pairDiscountOn = Math.abs(Number(adjustmentAmount) || 0) >= 0.005;
  const displayAmount = Math.abs(Number(adjustmentAmount) || 0);

  const settledCount = useMemo(
    () =>
      rows.filter(
        (row) => row.key !== "adjustment" && row.key !== "opening" && Math.abs(row.outstanding) < 0.005,
      ).length,
    [rows],
  );
  const visibleRows = useMemo(
    () => (showAllMonths ? rows : rows.filter(isOpenArrearsRow)),
    [rows, showAllMonths],
  );
  const yearCount = useMemo(() => {
    const years = new Set<string>();
    for (const row of rows) {
      const y = arrearsRowYearLabel(row);
      if (y) years.add(y);
    }
    return years.size;
  }, [rows]);

  let lastYearLabel: string | null = null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-600">
          月份明細
          <span className="ml-1 font-normal text-slate-500">
            （{visibleRows.length}/{rows.length}）
          </span>
        </p>
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-[11px]">
          <button
            type="button"
            className={`rounded px-2 py-1 font-semibold transition ${
              !showAllMonths ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
            onClick={() => setShowAllMonths(false)}
          >
            只看尚欠
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 font-semibold transition ${
              showAllMonths ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
            onClick={() => setShowAllMonths(true)}
          >
            全部月份
          </button>
        </div>
      </div>

      {!showAllMonths && settledCount > 0 ? (
        <p className="text-[10px] text-slate-500">
          已隱藏 {settledCount} 個已結清月份；需要對賬時可切換「全部月份」。
        </p>
      ) : null}

      <div className="max-h-[min(42vh,22rem)] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[20rem] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700 shadow-sm">
              <th className="px-2.5 py-2">月份</th>
              <th className="px-2.5 py-2 text-right">應繳學費</th>
              <th className="px-2.5 py-2 text-right">已繳金額</th>
              <th className="px-2.5 py-2 text-right">尚欠</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2.5 py-4 text-center text-slate-500">
                  目前沒有尚欠月份。
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const yearLabel = arrearsRowYearLabel(row);
                const showYearHeader =
                  yearCount > 1 && yearLabel != null && yearLabel !== lastYearLabel;
                if (showYearHeader) lastYearLabel = yearLabel;
                return (
                  <Fragment key={row.key}>
                    {showYearHeader ? (
                      <tr className="border-b border-slate-100 bg-slate-100/80">
                        <td colSpan={4} className="px-2.5 py-1.5 text-[11px] font-bold text-slate-700">
                          {yearLabel}
                        </td>
                      </tr>
                    ) : null}
                    <tr className="border-b border-slate-100 last:border-0">
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
                  </Fragment>
                );
              })
            )}
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

      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-3">
        <p className="text-[11px] font-bold text-emerald-950">調整／優惠</p>
        <label className="mt-2 flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            checked={pairDiscountOn}
            onChange={(e) => {
              if (e.target.checked) {
                const nextAbs =
                  Math.abs(Number(adjustmentAmount) || 0) >= 0.005
                    ? Math.abs(Number(adjustmentAmount) || 0)
                    : PAIR_DISCOUNT_PRESET_HKD;
                onAdjustmentChange({
                  amount: -nextAbs,
                  reason: adjustmentReason.trim() || PAIR_DISCOUNT_PRESET_REASON,
                });
                return;
              }
              onAdjustmentChange({ amount: 0, reason: "" });
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-emerald-950">
              二人同行優惠（預設 ${PAIR_DISCOUNT_PRESET_HKD}）
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug text-emerald-900/80">
              勾選即少收；金額可改。會計入 Total Due／Balance Due。
            </span>
          </span>
        </label>
        {pairDiscountOn ? (
          <div className="mt-2 flex flex-wrap items-end gap-2 pl-6">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-600">金額（港幣）</span>
              <input
                type="number"
                min={0}
                step="1"
                value={displayAmount}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    onAdjustmentChange({
                      amount: 0,
                      reason: adjustmentReason.trim() || PAIR_DISCOUNT_PRESET_REASON,
                    });
                    return;
                  }
                  const num = Number(raw);
                  if (!Number.isFinite(num)) return;
                  onAdjustmentChange({
                    amount: -Math.abs(num),
                    reason: adjustmentReason.trim() || PAIR_DISCOUNT_PRESET_REASON,
                  });
                }}
                className="w-[7.5rem] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs tabular-nums text-slate-800 outline-none transition focus:border-[#1d76c2] focus:ring-1 focus:ring-[#1d76c2]/30"
              />
            </label>
            <p className="pb-1.5 text-[10px] tabular-nums text-emerald-900/90">
              實際少收 −${formatHkMoneyAmount(displayAmount)}
              {adjustmentReason.trim() ? `（${adjustmentReason.trim()}）` : ""}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function feeSystemStartMonth1to12(sheetYear: number): number {
  return sheetYear === LESSON_SYSTEM_START_YEAR ? LESSON_SYSTEM_START_MONTH : 1;
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

const defaultRecordState = (): RecordState => ({
  weekday: "",
  expected: 0,
  submitted: 0,
  submittedLessonCount: null,
  lessonUnitPrice: 0,
  feePricingGrade: "",
  lValues: [],
  remedialCount: 0,
  remarks: "",
  makeupRemarks: "",
  balanceDueRemarks: "",
});

type RecordState = {
  weekday: string;
  expected: number;
  submitted: number;
  /** Zoho receipt quantity; Tuition Paid hint e.g. $820(4堂). */
  submittedLessonCount: number | null;
  /** Legacy DB column; tuition always uses global F1–F3 / F4–F6 tiers. */
  lessonUnitPrice: number;
  /** 空字串＝自動（按該月最後一日反推年級 + 9·1 升級）；否則 F1–F6 鎖定計價年級。 */
  feePricingGrade: string;
  lValues: number[];
  remedialCount: number;
  remarks: string;
  makeupRemarks: string;
  balanceDueRemarks: string;
};

type LessonRecord = {
  effectiveDate?: string;
  weekday: string;
  createdAt: number;
};

type SortDirection = "asc" | "desc";
type SortKey = "id" | "name" | "grade" | "weekday" | "expected" | "submitted";
type SortConfig = { key: SortKey; direction: SortDirection } | null;

export default function StudentsLessonTimeFeeRecordPage({
  initialBootstrap,
  initialYear,
  initialMonth,
  navViewer = null,
}: {
  initialBootstrap: FeeRecordBootstrapApiBody;
  initialYear: number;
  initialMonth: number;
  navViewer?: AppTopNavViewer | null;
}) {
  const initialHydrated = useMemo(
    () => hydrateFeeRecordBootstrap(initialBootstrap, initialYear, initialMonth),
    // Only seed once from server props — month/year changes refetch below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [students, setStudents] = useState<StudentRow[]>(() => initialHydrated.students as StudentRow[]);
  const [sheetMonth, setSheetMonth] = useState(() => initialMonth);
  const availableYears = useMemo(() => availableLessonYears(), []);
  const [sheetYear, setSheetYear] = useState(() => initialYear);
  const [recordsByStudentId, setRecordsByStudentId] = useState<Record<string, RecordState>>(() => {
    const next: Record<string, RecordState> = {};
    for (const [id, r] of Object.entries(initialHydrated.recordsByStudentId)) {
      next[id] = { ...defaultRecordState(), ...r };
    }
    return next;
  });
  const [submittedByStudentMonth, setSubmittedByStudentMonth] = useState(
    () => initialHydrated.submittedByStudentMonth,
  );
  const [openingBalanceByStudentId, setOpeningBalanceByStudentId] = useState(
    () => initialHydrated.openingBalanceByStudentId,
  );
  const [balanceAdjustmentByStudentId, setBalanceAdjustmentByStudentId] = useState<
    Record<string, StudentFeeBalanceAdjustment>
  >(() => initialHydrated.balanceAdjustmentByStudentId);
  /** 已存庫嘅「計價年級／劃一價」（fee_start..上月），用於重算以往月應收港幣。 */
  const [historicalMonthFeeByStudentId, setHistoricalMonthFeeByStudentId] = useState(
    () => initialHydrated.historicalMonthFeeByStudentId,
  );
  const [lessonRecordsByStudentId, setLessonRecordsByStudentId] = useState<
    Record<string, LessonRecord[]>
  >(() => initialHydrated.lessonRecordsByStudentId as Record<string, LessonRecord[]>);
  const [remedialCountByStudentId, setRemedialCountByStudentId] = useState(
    () => initialHydrated.remedialCountByStudentId,
  );
  const [lessonYearStateByStudentId, setLessonYearStateByStudentId] = useState(
    () => initialHydrated.lessonYearStateByStudentId,
  );
  const [visibilityByStudentId, setVisibilityByStudentId] = useState(
    () => initialHydrated.visibilityByStudentId,
  );
  const saveTimersRef = useState(() => new Map<string, number>())[0];
  const openingBalanceSaveTimersRef = useState(() => new Map<string, number>())[0];
  const balanceAdjustmentSaveTimersRef = useState(() => new Map<string, number>())[0];

  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [gradeFilter, setGradeFilter] = useState<string>("F.1");
  const [weekdayFilter, setWeekdayFilter] = useState<string>("all");
  const [sessionFilter, setSessionFilter] = useState<"all" | "short" | "ok">("all");
  const [balanceDueFilter, setBalanceDueFilter] = useState<"all" | "yes" | "no">("all");
  const [makeupFilter, setMakeupFilter] = useState<"all" | "yes" | "no">("all");
  const [searchText, setSearchText] = useState("");
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [feeTierBundle, setFeeTierBundle] = useState<StudentFeeTierBundle>(() =>
    initialHydrated.feeTierBundle
      ? {
          ...initialHydrated.feeTierBundle,
          legacy: { ...initialHydrated.feeTierBundle.legacy },
          current: { ...initialHydrated.feeTierBundle.current },
        }
      : {
          ...DEFAULT_FEE_TIER_BUNDLE,
          legacy: { ...DEFAULT_FEE_TIER_BUNDLE.legacy },
          current: { ...DEFAULT_FEE_TIER_BUNDLE.current },
        },
  );
  const [feeTierDraft, setFeeTierDraft] = useState<StudentFeeTierBundle>(() =>
    initialHydrated.feeTierBundle
      ? {
          ...initialHydrated.feeTierBundle,
          legacy: { ...initialHydrated.feeTierBundle.legacy },
          current: { ...initialHydrated.feeTierBundle.current },
        }
      : {
          ...DEFAULT_FEE_TIER_BUNDLE,
          legacy: { ...DEFAULT_FEE_TIER_BUNDLE.legacy },
          current: { ...DEFAULT_FEE_TIER_BUNDLE.current },
        },
  );
  const [feeTierSaveMsg, setFeeTierSaveMsg] = useState("");
  const [openingBalanceSaveMsg, setOpeningBalanceSaveMsg] = useState(
    () => initialHydrated.openingBalanceSaveMsg,
  );
  const [openingBalanceTableMissing, setOpeningBalanceTableMissing] = useState(
    () => initialHydrated.openingBalanceTableMissing,
  );
  const [balanceAdjustmentSaveMsg, setBalanceAdjustmentSaveMsg] = useState(
    () => initialHydrated.balanceAdjustmentSaveMsg,
  );
  const [balanceAdjustmentTableMissing, setBalanceAdjustmentTableMissing] = useState(
    () => initialHydrated.balanceAdjustmentTableMissing,
  );
  const pendingOpeningBalanceRef = useRef<Map<string, number>>(new Map());
  const pendingBalanceAdjustmentRef = useRef<Map<string, StudentFeeBalanceAdjustment>>(new Map());
  const skipBootstrapFetchRef = useRef(true);
  type FeeDetailDialogState =
    | { kind: "arrears"; studentId: string; title: string }
    | { kind: "makeup"; studentId: string };
  const [feeDetailDialog, setFeeDetailDialog] = useState<FeeDetailDialogState | null>(null);

  const onFeeDetailOpen = useCallback((dialog: FeeDetailDialogState) => {
    setFeeDetailDialog(dialog);
  }, []);

  const resetAllFilters = useCallback(() => {
    setGradeFilter("all");
    setWeekdayFilter("all");
    setSessionFilter("all");
    setBalanceDueFilter("all");
    setMakeupFilter("all");
    setSearchText("");
  }, []);

  useEffect(() => {
    if (!feeDetailDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFeeDetailDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [feeDetailDialog]);

  const applyHydratedBootstrap = useCallback((hydrated: ReturnType<typeof hydrateFeeRecordBootstrap>) => {
    setStudents(hydrated.students as StudentRow[]);
    setVisibilityByStudentId(hydrated.visibilityByStudentId);
    setRemedialCountByStudentId(hydrated.remedialCountByStudentId);
    setSubmittedByStudentMonth(hydrated.submittedByStudentMonth);
    setHistoricalMonthFeeByStudentId(hydrated.historicalMonthFeeByStudentId);
    setRecordsByStudentId(() => {
      const next: Record<string, RecordState> = {};
      for (const [id, r] of Object.entries(hydrated.recordsByStudentId)) {
        next[id] = { ...defaultRecordState(), ...r };
      }
      return next;
    });
    setOpeningBalanceByStudentId(hydrated.openingBalanceByStudentId);
    setOpeningBalanceTableMissing(hydrated.openingBalanceTableMissing);
    setOpeningBalanceSaveMsg(hydrated.openingBalanceSaveMsg);
    setBalanceAdjustmentByStudentId(hydrated.balanceAdjustmentByStudentId);
    setBalanceAdjustmentTableMissing(hydrated.balanceAdjustmentTableMissing);
    setBalanceAdjustmentSaveMsg(hydrated.balanceAdjustmentSaveMsg);
    setLessonRecordsByStudentId(hydrated.lessonRecordsByStudentId as Record<string, LessonRecord[]>);
    setLessonYearStateByStudentId(hydrated.lessonYearStateByStudentId);
    if (hydrated.feeTierBundle) {
      const t = {
        ...hydrated.feeTierBundle,
        legacy: { ...hydrated.feeTierBundle.legacy },
        current: { ...hydrated.feeTierBundle.current },
      };
      setFeeTierBundle(t);
      setFeeTierDraft(t);
    }
  }, []);

  useEffect(() => {
    if (skipBootstrapFetchRef.current) {
      skipBootstrapFetchRef.current = false;
      return;
    }
    let mounted = true;
    setBootstrapLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/students-lesson-fee-record/bootstrap?year=${sheetYear}&month=${sheetMonth}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!res.ok) throw new Error("bootstrap failed");
        const body = (await res.json()) as FeeRecordBootstrapApiBody;
        if (!mounted || !body.ok) return;
        applyHydratedBootstrap(hydrateFeeRecordBootstrap(body, sheetYear, sheetMonth));
      } catch {
        if (!mounted) return;
        setStudents([]);
      } finally {
        if (mounted) setBootstrapLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [sheetMonth, sheetYear, applyHydratedBootstrap]);

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

  const flushPendingOpeningBalances = useCallback(() => {
    for (const [studentId, value] of pendingOpeningBalanceRef.current) {
      const key = `${studentId}:${OPENING_BALANCE_AS_OF_YEAR}:${OPENING_BALANCE_AS_OF_MONTH}`;
      const existing = openingBalanceSaveTimersRef.get(key);
      if (existing) window.clearTimeout(existing);
      openingBalanceSaveTimersRef.delete(key);
      void upsertStudentFeeOpeningBalance(studentId, value);
    }
    pendingOpeningBalanceRef.current.clear();
  }, [openingBalanceSaveTimersRef]);

  const scheduleSaveOpeningBalance = useCallback((studentId: string, nextValue: number) => {
    pendingOpeningBalanceRef.current.set(studentId, nextValue);
    const key = `${studentId}:${OPENING_BALANCE_AS_OF_YEAR}:${OPENING_BALANCE_AS_OF_MONTH}`;
    const existing = openingBalanceSaveTimersRef.get(key);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      openingBalanceSaveTimersRef.delete(key);
      pendingOpeningBalanceRef.current.delete(studentId);
      void upsertStudentFeeOpeningBalance(studentId, nextValue).then((res) => {
        if (res.ok) {
          setOpeningBalanceTableMissing(false);
          setOpeningBalanceSaveMsg("");
          return;
        }
        setOpeningBalanceTableMissing(Boolean(res.tableMissing));
        setOpeningBalanceSaveMsg(
          res.tableMissing
            ? "期初結餘未能寫入雲端：請在 Supabase 執行 supabase/supabase_student_fee_opening_balances.sql（已暫存本機）"
            : `期初結餘儲存失敗：${res.error ?? "unknown"}（已暫存本機）`,
        );
      });
    }, 600);
    openingBalanceSaveTimersRef.set(key, t);
  }, [openingBalanceSaveTimersRef]);

  const onOpeningBalanceChange = useCallback((studentId: string, nextValue: number) => {
    writeFeeOpeningBalanceToLocal(studentId, nextValue);
    setOpeningBalanceByStudentId((prev) => ({ ...prev, [studentId]: nextValue }));
    scheduleSaveOpeningBalance(studentId, nextValue);
  }, [scheduleSaveOpeningBalance]);

  const flushPendingBalanceAdjustments = useCallback(() => {
    for (const [studentId, value] of pendingBalanceAdjustmentRef.current) {
      const existing = balanceAdjustmentSaveTimersRef.get(studentId);
      if (existing) window.clearTimeout(existing);
      balanceAdjustmentSaveTimersRef.delete(studentId);
      void upsertStudentFeeBalanceAdjustment(studentId, value);
    }
    pendingBalanceAdjustmentRef.current.clear();
  }, [balanceAdjustmentSaveTimersRef]);

  const scheduleSaveBalanceAdjustment = useCallback(
    (studentId: string, next: StudentFeeBalanceAdjustment) => {
      pendingBalanceAdjustmentRef.current.set(studentId, next);
      const existing = balanceAdjustmentSaveTimersRef.get(studentId);
      if (existing) window.clearTimeout(existing);
      const t = window.setTimeout(() => {
        balanceAdjustmentSaveTimersRef.delete(studentId);
        pendingBalanceAdjustmentRef.current.delete(studentId);
        void upsertStudentFeeBalanceAdjustment(studentId, next).then((res) => {
          if (res.ok) {
            setBalanceAdjustmentTableMissing(false);
            setBalanceAdjustmentSaveMsg("");
            return;
          }
          setBalanceAdjustmentTableMissing(Boolean(res.tableMissing));
          setBalanceAdjustmentSaveMsg(
            res.tableMissing
              ? "調整／優惠未能寫入雲端：請在 Supabase 執行 supabase/supabase_student_fee_balance_adjustments.sql（已暫存本機）"
              : `調整／優惠儲存失敗：${res.error ?? "unknown"}（已暫存本機）`,
          );
        });
      }, 600);
      balanceAdjustmentSaveTimersRef.set(studentId, t);
    },
    [balanceAdjustmentSaveTimersRef],
  );

  const onBalanceAdjustmentChange = useCallback(
    (studentId: string, next: StudentFeeBalanceAdjustment) => {
      const normalized = {
        amount: Number(next.amount) || 0,
        reason: String(next.reason ?? ""),
      };
      writeFeeBalanceAdjustmentToLocal(studentId, normalized);
      setBalanceAdjustmentByStudentId((prev) => ({ ...prev, [studentId]: normalized }));
      scheduleSaveBalanceAdjustment(studentId, normalized);
    },
    [scheduleSaveBalanceAdjustment],
  );

  useEffect(() => {
    const onLeave = () => {
      flushPendingOpeningBalances();
      flushPendingBalanceAdjustments();
    };
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onLeave);
      flushPendingOpeningBalances();
      flushPendingBalanceAdjustments();
    };
  }, [flushPendingOpeningBalances, flushPendingBalanceAdjustments]);

  const scheduleSave = useCallback((studentId: string, patch: Partial<RecordState>) => {
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
        lessonUnitPrice: 0,
        feePricingGrade: String(merged.feePricingGrade ?? ""),
        remarks: String(merged.remarks ?? ""),
        makeupRemarks: String(merged.makeupRemarks ?? ""),
        balanceDueRemarks: String(merged.balanceDueRemarks ?? ""),
      });
    }, 600);
    saveTimersRef.set(key, t);
  }, [recordsByStudentId, saveTimersRef, sheetMonth, sheetYear]);

  const sheetGradeByStudentId = useMemo(() => {
    const out: Record<string, string> = {};
    for (const st of students) {
      out[st.id] = inferGradeAtSheetEnd(st.grade, sheetYear, sheetMonth);
    }
    return out;
  }, [students, sheetYear, sheetMonth]);

  const sortedStudents = useMemo(() => {
    const getRec = (id: string) => recordsByStudentId[id];
    const gradeOf = (st: StudentRow) => sheetGradeByStudentId[st.id] || st.grade;

    return [...students].sort((a, b) => {
      // default: F1 -> F6 (as of sheet month), then by student ID
      if (!sortConfig) {
        const ga = gradeRank(gradeOf(a));
        const gb = gradeRank(gradeOf(b));
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
          result = gradeRank(gradeOf(a)) - gradeRank(gradeOf(b));
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
  }, [students, recordsByStudentId, sortConfig, sheetGradeByStudentId]);

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

  const inactiveDateCheckerByStudentId = useMemo(() => {
    const out: Record<string, ((dateIso: string) => boolean) | undefined> = {};
    for (const st of students) {
      const vis = visibilityByStudentId[st.id];
      out[st.id] = makeStudentInactiveDateCheckerFromPeriods({
        studentId: st.id,
        grade: inferGradeAtSheetEnd(st.grade, sheetYear, sheetMonth),
        year: sheetYear,
        periods: vis?.periods ?? [],
      });
    }
    return out;
  }, [students, visibilityByStudentId, sheetYear, sheetMonth]);

  const isMonthInactiveForFeeByStudentId = useMemo(() => {
    const out: Record<string, (month1to12: number) => boolean> = {};
    for (const st of students) {
      const vis = visibilityByStudentId[st.id];
      out[st.id] = (month1to12: number) =>
        isStudentHiddenForFeeSheetMonthFromPeriods({
          studentId: st.id,
          grade: inferGradeAtSheetEnd(st.grade, sheetYear, month1to12),
          periods: vis?.periods ?? [],
          sheetYear,
          sheetMonth: month1to12,
        });
    }
    return out;
  }, [students, visibilityByStudentId, sheetYear]);

  const attendedLessonsInMonthByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    const m = Number(sheetMonth);
    for (const st of students) {
      if (isMonthInactiveForFeeByStudentId[st.id]?.(m)) {
        out[st.id] = 0;
        continue;
      }
      const records = normalizeFeeLessonRecords(lessonRecordsByStudentId[st.id] ?? []);
      const state = toYearLessonStateFromClient(lessonYearStateByStudentId[st.id]);
      out[st.id] = countAttendedBillableLessonsInMonth({
        records,
        state,
        year: sheetYear,
        month1to12: m,
        isDateInactive: inactiveDateCheckerByStudentId[st.id],
      });
    }
    return out;
  }, [
    students,
    sheetYear,
    sheetMonth,
    lessonRecordsByStudentId,
    lessonYearStateByStudentId,
    inactiveDateCheckerByStudentId,
    isMonthInactiveForFeeByStudentId,
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
      const amount = Number(submitted) || 0;
      updateStudentRecord(studentId, { submitted: amount });
      // Keep prior-month arrears map in sync while staying on / switching away from this sheet month.
      setSubmittedByStudentMonth((prev) => {
        const byMonth = { ...(prev[studentId] ?? {}) };
        byMonth[Number(sheetMonth)] = amount;
        return { ...prev, [studentId]: byMonth };
      });
      scheduleSave(studentId, { submitted: amount });
    },
    [scheduleSave, sheetMonth],
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

  const saveFeeTierSettings = useCallback(async () => {
    setFeeTierSaveMsg("");
    const res = await saveStudentFeeTierSettings(feeTierDraft);
    if (!res.ok) {
      setFeeTierSaveMsg(res.error ?? "Save failed");
      return;
    }
    setFeeTierBundle({ ...feeTierDraft });
    setFeeTierSaveMsg(res.cloudSynced ? "Saved + cloud" : "Saved locally");
    notifyScheduleCachesStale();
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
        preservedExistingMonths?: number;
        preservedExistingSamples?: string[];
      };
      const monthMap = (json?.monthSubmittedByStudentId ?? {}) as Record<string, number>;
      const lessonCountMap = (json?.monthSubmittedLessonCountByStudentId ?? {}) as Record<string, number>;
      const byStudentMonth = (json?.submittedByStudentMonth ?? {}) as Record<
        string,
        Record<number, number>
      >;
      if (Object.keys(byStudentMonth).length > 0) {
        setSubmittedByStudentMonth((prev) => {
          const next = { ...prev };
          for (const [sid, months] of Object.entries(byStudentMonth)) {
            next[sid] = { ...(next[sid] ?? {}), ...months };
          }
          return next;
        });
      }
      if (Object.keys(monthMap).length > 0) {
        setRecordsByStudentId((prev) => {
          const next = { ...prev };
          for (const [sid, submitted] of Object.entries(monthMap)) {
            const lessonCount = lessonCountMap[sid];
            next[sid] = {
              ...(next[sid] ?? defaultRecordState()),
              submitted: Number(submitted) || 0,
              submittedLessonCount:
                lessonCount != null && Number.isFinite(Number(lessonCount)) && Number(lessonCount) > 0
                  ? Number(lessonCount)
                  : (next[sid]?.submittedLessonCount ?? null),
            };
          }
          return next;
        });
      }
      setSyncNotice(
        `Zoho synced (${sheetYear}). Fetched ${Number(json?.fetchedReceipts ?? 0)} receipts; updated ${Number(json?.syncedRows ?? 0)} rows; ${Number(json?.unmatchedReceipts ?? 0)} unmatched; preserved ${Number(debug.preservedExistingMonths ?? 0)} existing month amount(s).${
          Array.isArray(json?.unmatchedExamples) && json.unmatchedExamples.length
            ? ` Unmatched examples: ${json.unmatchedExamples.join(" / ")}`
            : ""
        } Debug: matched ${Number(debug.matchedReceipts ?? 0)}, line items ${Number(debug.totalLineItems ?? 0)}, parsed-month items ${Number(debug.parsedMonthLineItems ?? 0)}, detail calls ${Number(debug.detailCalls ?? 0)}, skipped details ${Number(debug.skippedDetailByLimit ?? 0)}, detail success ${Number(debug.detailFetchSuccess ?? 0)}, detail empty ${Number(debug.detailFetchEmpty ?? 0)}, detail errors ${Number(debug.detailFetchError ?? 0)}${
          Array.isArray(debug.detailErrorSamples) && debug.detailErrorSamples.length
            ? `, detail error samples: ${debug.detailErrorSamples.join(" / ")}`
            : ""
        }${
          Array.isArray(debug.preservedExistingSamples) && debug.preservedExistingSamples.length
            ? `, preserved: ${debug.preservedExistingSamples.join(" / ")}`
            : ""
        }.`,
      );
      // Always bust fee bootstrap cache after sync (even 0 upserts) so Sep/Aug views stay consistent.
      await revalidateScheduleCachesNow();
      if (Number(json?.syncedRows ?? 0) > 0) {
        window.location.reload();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
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

  const { lessonDatesByStudentId, fullLessonDatesByStudentId, lColumnCount } = useMemo(() => {
    const byStudent: Record<string, string[]> = {};
    const full: Record<string, string[]> = {};
    let maxAttended = MIN_L_COLUMN_COUNT;
    const currentMonth = Number(sheetMonth);
    for (const st of students) {
      const legacyWeekdays = weekdayTokensByStudentId[st.id] ?? [];
      const records = normalizeFeeLessonRecords(lessonRecordsByStudentId[st.id] ?? []);
      const state = toYearLessonStateFromClient(lessonYearStateByStudentId[st.id]);
      const monthInactive = isMonthInactiveForFeeByStudentId[st.id]?.(currentMonth);
      const common = {
        records,
        state,
        year: sheetYear,
        month1to12: currentMonth,
        legacyWeekdays,
        isDateInactive: inactiveDateCheckerByStudentId[st.id],
      };
      full[st.id] = monthInactive ? [] : collectBillableLessonDatesForMonth(common);
      const attended = monthInactive ? [] : collectAttendedBillableLessonDatesForMonth(common);
      byStudent[st.id] = attended;
      if (attended.length > maxAttended) maxAttended = attended.length;
    }
    return {
      lessonDatesByStudentId: byStudent,
      fullLessonDatesByStudentId: full,
      lColumnCount: Math.max(MIN_L_COLUMN_COUNT, maxAttended),
    };
  }, [
    students,
    weekdayTokensByStudentId,
    lessonRecordsByStudentId,
    lessonYearStateByStudentId,
    sheetYear,
    sheetMonth,
    inactiveDateCheckerByStudentId,
    isMonthInactiveForFeeByStudentId,
  ]);

  /** Live Makeup count (prior calendar month unticked); matches Makeup column & filter. */
  const { makeupLiveCountByStudentId, makeupHasLessonPayloadByStudentId } = useMemo(() => {
    const counts: Record<string, number> = {};
    const hasPayloadById: Record<string, boolean> = {};
    for (const st of students) {
      const sid = st.id;
      const recs = (lessonRecordsByStudentId[sid] ?? []) as unknown as Lesson2026Record[];
      const ys = lessonYearStateByStudentId[sid];
      const hasLessonPayload =
        recs.length > 0 ||
        ys != null ||
        Object.prototype.hasOwnProperty.call(lessonRecordsByStudentId, sid) ||
        Object.prototype.hasOwnProperty.call(lessonYearStateByStudentId, sid);
      hasPayloadById[sid] = hasLessonPayload;
      if (!hasLessonPayload) {
        counts[sid] = remedialCountByStudentId[sid] ?? 0;
        continue;
      }
      const state: Lesson2026State = {
        attendance: ys?.attendance ?? {},
        hiddenDates: ys?.hiddenDates ?? {},
        overrides: (ys?.overrides ?? {}) as Lesson2026State["overrides"],
        rescheduleEntries: (ys?.rescheduleEntries as Lesson2026State["rescheduleEntries"]) ?? [],
        extraEntries: (ys?.extraEntries as Lesson2026State["extraEntries"]) ?? [],
      };
      counts[sid] = getUpcomingUntickedDates(recs, state, Date.now(), sheetYear, {
        isDateInactive: inactiveDateCheckerByStudentId[sid],
      }).length;
    }
    return {
      makeupLiveCountByStudentId: counts,
      makeupHasLessonPayloadByStudentId: hasPayloadById,
    };
  }, [
    students,
    lessonRecordsByStudentId,
    lessonYearStateByStudentId,
    sheetYear,
    remedialCountByStudentId,
    inactiveDateCheckerByStudentId,
  ]);

  const feeDialogMakeupDetail = useMemo(() => {
    if (!feeDetailDialog || feeDetailDialog.kind !== "makeup") {
      return { dates: [] as string[], dbOnly: false, liveCount: 0, hasLessonPayload: false };
    }
    const sid = feeDetailDialog.studentId;
    const recs = (lessonRecordsByStudentId[sid] ?? []) as unknown as Lesson2026Record[];
    const ys = lessonYearStateByStudentId[sid] ?? emptyLessonYearState();
    const hasLessonPayload =
      recs.length > 0 ||
      ys != null ||
      Object.prototype.hasOwnProperty.call(lessonRecordsByStudentId, sid) ||
      Object.prototype.hasOwnProperty.call(lessonYearStateByStudentId, sid);
    const state: Lesson2026State = {
      attendance: ys.attendance,
      hiddenDates: ys.hiddenDates,
      overrides: (ys.overrides ?? {}) as Lesson2026State["overrides"],
      rescheduleEntries: (ys.rescheduleEntries as Lesson2026State["rescheduleEntries"]) ?? [],
      extraEntries: (ys.extraEntries as Lesson2026State["extraEntries"]) ?? [],
    };
    const dates = hasLessonPayload
      ? getUpcomingUntickedDates(recs, state, Date.now(), sheetYear, {
          isDateInactive: inactiveDateCheckerByStudentId[sid],
        })
      : [];
    const dbN = remedialCountByStudentId[sid] ?? 0;
    return {
      dates,
      dbOnly: !hasLessonPayload && dbN > 0,
      liveCount: dates.length,
      hasLessonPayload,
    };
  }, [
    feeDetailDialog,
    lessonRecordsByStudentId,
    lessonYearStateByStudentId,
    sheetYear,
    remedialCountByStudentId,
    inactiveDateCheckerByStudentId,
  ]);

  const currentMonthExpectedTuitionByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    const currentMonth = Number(sheetMonth);
    for (const st of students) {
      if (isMonthInactiveForFeeByStudentId[st.id]?.(currentMonth)) {
        out[st.id] = 0;
        continue;
      }
      const r = recordsByStudentId[st.id] ?? defaultRecordState();
      const dates = fullLessonDatesByStudentId[st.id] ?? [];
      const gradeFor = gradeForFeePricing(st, sheetYear, currentMonth, r.feePricingGrade);
      const tier = resolveFeeTierSettingsForStudent(feeTierBundle, st.id, sheetYear, currentMonth);
      out[st.id] = sumSlotTuitionHkdFromDates({
        fullLessonDates: dates,
        gradeFor,
        feeTierSettings: tier,
      });
    }
    return out;
  }, [
    students,
    recordsByStudentId,
    fullLessonDatesByStudentId,
    sheetYear,
    sheetMonth,
    feeTierBundle,
    isMonthInactiveForFeeByStudentId,
  ]);

  const priorExpectedTuitionSumByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    const currentMonth = Number(sheetMonth);
    const feeStartMonth = feeSystemStartMonth1to12(sheetYear);
    for (const st of students) {
      let sum = 0;
      const legacyWeekdays = weekdayTokensByStudentId[st.id] ?? [];
      const records = normalizeFeeLessonRecords(lessonRecordsByStudentId[st.id] ?? []);
      const state = toYearLessonStateFromClient(lessonYearStateByStudentId[st.id]);
      for (let m = feeStartMonth; m < currentMonth; m += 1) {
        if (isMonthInactiveForFeeByStudentId[st.id]?.(m)) continue;
        const dates = collectBillableLessonDatesForMonth({
          records,
          state,
          year: sheetYear,
          month1to12: m,
          legacyWeekdays,
          isDateInactive: inactiveDateCheckerByStudentId[st.id],
        });
        const hist = historicalMonthFeeByStudentId[st.id]?.[m];
        const gradeFor = gradeForFeePricing(st, sheetYear, m, hist?.feePricingGrade ?? "");
        const tier = resolveFeeTierSettingsForStudent(feeTierBundle, st.id, sheetYear, m);
        sum += sumSlotTuitionHkdFromDates({ fullLessonDates: dates, gradeFor, feeTierSettings: tier });
      }
      out[st.id] = sum;
    }
    return out;
  }, [
    students,
    sheetYear,
    sheetMonth,
    weekdayTokensByStudentId,
    lessonRecordsByStudentId,
    lessonYearStateByStudentId,
    feeTierBundle,
    historicalMonthFeeByStudentId,
    inactiveDateCheckerByStudentId,
    isMonthInactiveForFeeByStudentId,
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
      const adjustment = Number(balanceAdjustmentByStudentId[st.id]?.amount ?? 0) || 0;
      out[st.id] = balanceBefore + thisMonth + adjustment;
    }
    return out;
  }, [
    students,
    balanceBeforeByStudentId,
    currentMonthExpectedTuitionByStudentId,
    balanceAdjustmentByStudentId,
  ]);

  const filteredSortedStudents = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return sortedStudents.filter((st) => {
      const r = recordsByStudentId[st.id] ?? defaultRecordState();
      const expectedSessions = r.expected ?? 0;
      const attended = attendedLessonsInMonthByStudentId[st.id] ?? 0;
      const matchesGrade =
        normalizedSearch.length > 0 ||
        gradeFilter === "all" ||
        formatGradeDisplay(sheetGradeByStudentId[st.id] || st.grade) === gradeFilter;
      const matchesWeekday =
        weekdayFilter === "all" ||
        (weekdayTokensByStudentId[st.id] ?? []).includes(weekdayFilter);
      const matchesSession =
        sessionFilter === "all" ||
        (sessionFilter === "short"
          ? expectedSessions > 0 && attended < expectedSessions
          : expectedSessions === 0 || attended >= expectedSessions);
      const hasMakeup = (makeupLiveCountByStudentId[st.id] ?? 0) > 0;
      const totalDue = Number(totalDueByStudentId[st.id] ?? 0) || 0;
      const owesMoney = totalDue - (Number(r.submitted) || 0) > 0.005;
      const matchesBalanceDue =
        balanceDueFilter === "all" ||
        (balanceDueFilter === "yes" ? owesMoney : !owesMoney);
      const matchesMakeup =
        makeupFilter === "all" || (makeupFilter === "yes" ? hasMakeup : !hasMakeup);
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
        matchesSession &&
        matchesBalanceDue &&
        matchesMakeup &&
        matchesSearch
      );
    });
  }, [
    sortedStudents,
    recordsByStudentId,
    gradeFilter,
    weekdayFilter,
    sessionFilter,
    balanceDueFilter,
    makeupFilter,
    searchText,
    weekdayTokensByStudentId,
    attendedLessonsInMonthByStudentId,
    makeupLiveCountByStudentId,
    totalDueByStudentId,
    sheetGradeByStudentId,
  ]);

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
    contentKey: `${filteredSortedStudents.length}:${sheetYear}:${sheetMonth}`,
  });

  const feeRowVirtualizer = useVirtualizer({
    count: filteredSortedStudents.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 88,
    overscan: 10,
  });
  const feeVirtualRows = feeRowVirtualizer.getVirtualItems();
  const feePadTop = feeVirtualRows[0]?.start ?? 0;
  const feePadBottom =
    feeRowVirtualizer.getTotalSize() - (feeVirtualRows[feeVirtualRows.length - 1]?.end ?? 0);
  const feeTableColSpan = 10 + lColumnCount + (sheetYear === OPENING_BALANCE_AS_OF_YEAR ? 1 : 0);

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
      balanceAdjustment: balanceAdjustmentByStudentId[st.id] ?? emptyFeeBalanceAdjustment(),
      currentRecord: recordsByStudentId[st.id] ?? defaultRecordState(),
      historicalMonthFee: historicalMonthFeeByStudentId[st.id] ?? {},
      submittedByMonth: submittedByStudentMonth[st.id] ?? {},
      lessonRecords: lessonRecordsByStudentId[st.id] ?? [],
      yearState: lessonYearStateByStudentId[st.id],
      legacyWeekdays: weekdayTokensByStudentId[st.id] ?? [],
      feeTierBundle,
      isMonthInactiveForFee: isMonthInactiveForFeeByStudentId[st.id],
      isDateInactive: inactiveDateCheckerByStudentId[st.id],
    });
  }, [
    feeDetailDialog,
    studentById,
    sheetYear,
    sheetMonth,
    recordsByStudentId,
    openingBalanceByStudentId,
    balanceAdjustmentByStudentId,
    historicalMonthFeeByStudentId,
    submittedByStudentMonth,
    weekdayTokensByStudentId,
    lessonRecordsByStudentId,
    lessonYearStateByStudentId,
    feeTierBundle,
    inactiveDateCheckerByStudentId,
    isMonthInactiveForFeeByStudentId,
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
    const todayIso = feeRecordToHkIsoDateFromMs(Date.now());

    setRecordsByStudentId((prev) => {
      const next = { ...prev };
      for (const st of students) {
        if (!next[st.id]) next[st.id] = defaultRecordState();
        const records = lessonRecordsByStudentId[st.id] ?? [];
        const weekdays = getActiveWeekdaysForFeeRecord(records, todayIso);
        const finalWeekday =
          weekdays.length > 0
            ? weekdays.join("/")
            : next[st.id].weekday;
        const effectiveWeekdays = finalWeekday
          .split("/")
          .map((v) => v.trim())
          .filter(Boolean);
        const currentMonth = Number(sheetMonth);
        const monthInactive = isMonthInactiveForFeeByStudentId[st.id]?.(currentMonth) ?? false;
        const billableDates = monthInactive
          ? []
          : collectBillableLessonDatesForMonth({
              records: normalizeFeeLessonRecords(records),
              state: toYearLessonStateFromClient(lessonYearStateByStudentId[st.id]),
              year: sheetYear,
              month1to12: currentMonth,
              legacyWeekdays: effectiveWeekdays,
              isDateInactive: inactiveDateCheckerByStudentId[st.id],
            });

        next[st.id] = {
          ...next[st.id],
          weekday: finalWeekday,
          expected: billableDates.length,
        };
      }
      return next;
    });
  }, [
    students,
    lessonRecordsByStudentId,
    lessonYearStateByStudentId,
    sheetMonth,
    sheetYear,
    inactiveDateCheckerByStudentId,
    isMonthInactiveForFeeByStudentId,
  ]);

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav viewer={navViewer} />
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
                      {bootstrapLoading ? (
                        <span className="ml-2 text-xs font-semibold text-amber-700">Loading month…</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 max-w-[52rem] text-[11px] text-slate-500">
                      {`Total Due = 期初結餘（截至 ${OPENING_BALANCE_AS_OF_EN_PHRASE}）＋ ${FEE_SYSTEM_START_EN_PHRASE} 起累計學費 − 已繳 ＋ 本月學費 ＋ 調整／優惠。舊系統月份不會逐月回填。`}
                      <span className="mt-0.5 block text-slate-600">
                        學費按該表月份的上課年級（9/1 升班前會顯示升班前年級）＋ F1–F3／F4–F6 價目計算。若資料庫曾鎖定計價年級或劃一價，仍會沿用。
                      </span>
                      <span className="mt-1.5 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-950">
                        <span className="font-semibold">留班（重讀同級）：</span>
                        若會跑 9/1 全表升班，可於 8/31 將學籍暫改為低一級（例 F.3→F.2），升班後確認檔案仍回到 F.3。
                      </span>
                      {sheetYear === OPENING_BALANCE_AS_OF_YEAR &&
                      (openingBalanceSaveMsg || openingBalanceTableMissing) ? (
                        <span className="mt-1.5 block rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-950">
                          {openingBalanceSaveMsg ||
                            "期初結餘表未建立：請在 Supabase 執行 supabase/supabase_student_fee_opening_balances.sql"}
                        </span>
                      ) : null}
                      {balanceAdjustmentSaveMsg || balanceAdjustmentTableMissing ? (
                        <span className="mt-1.5 block rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-950">
                          {balanceAdjustmentSaveMsg ||
                            "調整／優惠表未建立：請在 Supabase 執行 supabase/supabase_student_fee_balance_adjustments.sql"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void syncZohoSubmitted({
                        studentIds: filteredSortedStudents.map((s) => s.id),
                        idOnly: false,
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
                    placeholder="e.g. 9123 / Chan / 00123 — all grades"
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
                <label className="min-w-[150px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                    未比錢 Balance Due
                  </span>
                  <select
                    value={balanceDueFilter}
                    onChange={(e) => setBalanceDueFilter(e.target.value as "all" | "yes" | "no")}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  >
                    <option value="all">All</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="min-w-[150px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                    未補堂 Makeup
                  </span>
                  <select
                    value={makeupFilter}
                    onChange={(e) => setMakeupFilter(e.target.value as "all" | "yes" | "no")}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  >
                    <option value="all">All</option>
                    <option value="yes">Yes（有未補堂）</option>
                    <option value="no">No（無未補堂）</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={resetAllFilters}
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
                    id={tableScrollId}
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
                            sublabel="as of month"
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
                          {Array.from({ length: lColumnCount }, (_, i) => (
                            <th
                              key={i}
                              className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-2 py-3 text-center text-[11px]"
                              style={{ minWidth: L_COL_WIDTH }}
                              title="已出席堂數：恆常／加堂＝當月日期；補堂＝原本取消日→補堂日"
                            >
                              L{i + 1}
                            </th>
                          ))}
                          <th
                            className="sticky top-0 z-30 bg-slate-50 px-2 py-3 text-left"
                            style={{ minWidth: MAKEUP_COL_WIDTH }}
                            title="與課表 Makeup Count 相同；只計上一個曆月未打勾補堂（例：5 月只計 4 月）。Inactive／放假期間唔計。"
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
                        </tr>
                      </thead>

                      <tbody>
                        <VirtualTableSpacerRow height={feePadTop} colSpan={feeTableColSpan} />
                        {feeVirtualRows.map((virtualRow) => {
                          const index = virtualRow.index;
                          const st = filteredSortedStudents[index];
                          if (!st) return null;
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
                          const sheetGrade = sheetGradeByStudentId[st.id] || st.grade;
                          const prevSheetGrade = prev
                            ? sheetGradeByStudentId[prev.id] || prev.grade
                            : "";
                          const showGradeSeparatorTop =
                            prev != null && prevSheetGrade.trim() !== sheetGrade.trim();
                          return (
                            <StudentFeeRow
                              key={st.id}
                              student={st}
                              sheetGrade={sheetGrade}
                              record={r}
                              underPaid={underPaid}
                              arrearsDue={arrearsDue}
                              totalDue={totalDue}
                              balanceCarryForward={balanceCarryForward}
                              lessonDatesSerialized={lessonDatesSerialized}
                              lColumnCount={lColumnCount}
                              thisMonthDatedSlotCount={thisMonthDatedSlotCount}
                              makeupLiveCount={makeupLiveCountByStudentId[st.id] ?? 0}
                              remedialCountDb={remedialCountByStudentId[st.id] ?? 0}
                              hasLessonPayload={makeupHasLessonPayloadByStudentId[st.id] ?? false}
                              showGradeSeparatorTop={showGradeSeparatorTop}
                              showOpeningEditor={sheetYear === OPENING_BALANCE_AS_OF_YEAR}
                              openingBalance={openingBalanceByStudentId[st.id] ?? 0}
                              onOpeningBalanceChange={onOpeningBalanceChange}
                              hasBalanceAdjustment={
                                Math.abs(Number(balanceAdjustmentByStudentId[st.id]?.amount ?? 0) || 0) >=
                                  0.005 ||
                                Boolean(String(balanceAdjustmentByStudentId[st.id]?.reason ?? "").trim())
                              }
                              onSubmittedChange={onSubmittedChange}
                              onRemarksChange={onRemarksChange}
                              currentMonthExpectedMoney={currentMonthExpectedTuitionByStudentId[st.id] ?? 0}
                              feeTierBundle={feeTierBundle}
                              onFeeDetailOpen={onFeeDetailOpen}
                            />
                          );
                        })}
                        <VirtualTableSpacerRow height={feePadBottom} colSpan={feeTableColSpan} />
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

              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-sm font-bold text-amber-800">
                  {`* L1–L${lColumnCount}：本月已出席堂數（恆常／加堂按當月日期；補堂按原本取消日，例：1/6、10/6→11/6、30/6、12/6→2/7）。欄數會按該月最多出席堂數自動加多（最少 ${MIN_L_COLUMN_COUNT} 欄）。`}
                </div>
                <div className="mt-2 text-sm text-amber-900">* After confirmation, I can connect these cells to the auto-calculation logic for lesson time and tuition.</div>
              </div>

              <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50/90 p-3 text-[13.2px]">
                <summary className="cursor-pointer select-none font-semibold text-slate-800">
                  Lesson tiers (legacy / current)
                </summary>
                <p className="mt-2 text-[12.1px] leading-snug text-slate-600">
                  <span className="font-semibold">Legacy</span> = everyone not listed below, until global switch (includes referrals on old price).
                  <span className="font-semibold"> Current</span> = listed student ids only before 1 Sep; everyone from 1 Sep onward.
                  Whole-month rate: ≤(Split−1) lessons → all Normal; ≥Split lessons → all Discount
                  (default Split 8 → ≤7 Normal, ≥8 all Discount). Applies to both tables.
                </p>
                <p className="mt-1 text-[12.1px] leading-snug text-slate-600">
                  <span className="font-semibold">Save</span> stores locally; Supabase syncs when{" "}
                  <code className="rounded bg-slate-200/80 px-0.5">app_student_fee_tier_settings</code> has dual-price columns.
                </p>
                <div className="mt-3 space-y-3">
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Legacy (舊生)</p>
                    <FeeTierPriceFields
                      tiers={feeTierDraft.legacy}
                      onPatch={(patch) =>
                        setFeeTierDraft((d) => ({
                          ...d,
                          legacy: { ...d.legacy, ...patch },
                        }))
                      }
                    />
                  </div>
                  <div className="rounded-md border border-sky-200 bg-sky-50/40 px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800">Current (新生 / 9·1 後全员)</p>
                    <FeeTierPriceFields
                      tiers={feeTierDraft.current}
                      onPatch={(patch) =>
                        setFeeTierDraft((d) => ({
                          ...d,
                          current: { ...d.current, ...patch },
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 whitespace-nowrap text-[12.1px] font-semibold text-slate-500">
                        Discount from (≥N 堂)
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={feeTierDraft.legacy.lesson_tier_break_after}
                        onChange={(e) => {
                          const br = Math.min(24, Math.max(1, Math.floor(Number(e.target.value) || 8)));
                          setFeeTierDraft((d) => ({
                            ...d,
                            legacy: { ...d.legacy, lesson_tier_break_after: br },
                            current: { ...d.current, lesson_tier_break_after: br },
                          }));
                        }}
                        className="w-11 shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[14.52px] tabular-nums"
                        suppressHydrationWarning
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1 sm:col-span-2">
                      <span className="text-[12.1px] font-semibold text-slate-500">
                        Students on new price（學號，一行一個或逗號分隔）
                      </span>
                      <textarea
                        rows={4}
                        placeholder={"00150\n00152"}
                        value={feeTierDraft.currentPriceStudentIds}
                        onChange={(e) =>
                          setFeeTierDraft((d) => ({
                            ...d,
                            currentPriceStudentIds: e.target.value,
                          }))
                        }
                        className="min-h-[5rem] w-full max-w-md rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[13.2px] tabular-nums leading-snug"
                        suppressHydrationWarning
                      />
                    </label>
                    <label className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 whitespace-nowrap text-[12.1px] font-semibold text-slate-500">
                        All switch (9/1)
                      </span>
                      <input
                        type="date"
                        value={feeTierDraft.globalPriceSwitchDate}
                        onChange={(e) =>
                          setFeeTierDraft((d) => ({
                            ...d,
                            globalPriceSwitchDate: e.target.value || d.globalPriceSwitchDate,
                          }))
                        }
                        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[13.2px]"
                        suppressHydrationWarning
                      />
                    </label>
                  </div>
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
                      feeDialogMakeupDetail.liveCount,
                      remedialCountByStudentId[feeDetailDialog.studentId] ?? 0,
                      feeDialogMakeupDetail.hasLessonPayload,
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
                  adjustmentAmount={
                    Number(balanceAdjustmentByStudentId[feeDetailDialog.studentId]?.amount ?? 0) || 0
                  }
                  adjustmentReason={
                    balanceAdjustmentByStudentId[feeDetailDialog.studentId]?.reason ?? ""
                  }
                  onAdjustmentChange={(next) =>
                    onBalanceAdjustmentChange(feeDetailDialog.studentId, next)
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
  /** Grade as of the fee sheet month (Sept-1 promotion rollback). */
  sheetGrade: string;
  record: RecordState;
  underPaid: boolean;
  arrearsDue: number;
  totalDue: number;
  balanceCarryForward: number;
  lessonDatesSerialized: string;
  lColumnCount: number;
  makeupLiveCount: number;
  remedialCountDb: number;
  hasLessonPayload: boolean;
  /** Add a stronger top border when grade changes from previous row. */
  showGradeSeparatorTop: boolean;
  showOpeningEditor: boolean;
  openingBalance: number;
  onOpeningBalanceChange: (studentId: string, value: number) => void;
  hasBalanceAdjustment: boolean;
  onSubmittedChange: (studentId: string, submitted: number) => void;
  onRemarksChange: (studentId: string, remarks: string) => void;
  /** 本月按階梯／劃一計出嘅應收港幣（同 Total Due − Prev 一致）。 */
  currentMonthExpectedMoney: number;
  /** 本月課表有日期嘅檔位數（用於 $xx(N堂) 顯示）。 */
  thisMonthDatedSlotCount: number;
  feeTierBundle: StudentFeeTierBundle;
  onFeeDetailOpen: (dialog: { kind: "arrears"; studentId: string; title: string } | { kind: "makeup"; studentId: string }) => void;
};

function FeeTierPriceFields({
  tiers,
  onPatch,
}: {
  tiers: StudentFeeTierSettings;
  onPatch: (patch: Partial<StudentFeeTierSettings>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">F1-F3 (Normal)</span>
        <input
          type="number"
          inputMode="decimal"
          value={tiers.f_low_tier_1_8}
          onChange={(e) => onPatch({ f_low_tier_1_8: Number(e.target.value) || 0 })}
          className="w-[4rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[13.2px] tabular-nums"
          suppressHydrationWarning
        />
      </label>
      <label className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">F1-F3 (Discount)</span>
        <input
          type="number"
          inputMode="decimal"
          value={tiers.f_low_tier_9_plus}
          onChange={(e) => onPatch({ f_low_tier_9_plus: Number(e.target.value) || 0 })}
          className="w-[4rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[13.2px] tabular-nums"
          suppressHydrationWarning
        />
      </label>
      <label className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">F4-F6 (Normal)</span>
        <input
          type="number"
          inputMode="decimal"
          value={tiers.f_high_tier_1_8}
          onChange={(e) => onPatch({ f_high_tier_1_8: Number(e.target.value) || 0 })}
          className="w-[4rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[13.2px] tabular-nums"
          suppressHydrationWarning
        />
      </label>
      <label className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">F4-F6 (Discount)</span>
        <input
          type="number"
          inputMode="decimal"
          value={tiers.f_high_tier_9_plus}
          onChange={(e) => onPatch({ f_high_tier_9_plus: Number(e.target.value) || 0 })}
          className="w-[4rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-[13.2px] tabular-nums"
          suppressHydrationWarning
        />
      </label>
    </div>
  );
}

const StudentFeeRow = memo(function StudentFeeRow({
  student,
  sheetGrade,
  record,
  underPaid,
  arrearsDue,
  totalDue,
  balanceCarryForward,
  lessonDatesSerialized,
  lColumnCount,
  makeupLiveCount,
  remedialCountDb,
  hasLessonPayload,
  showGradeSeparatorTop,
  showOpeningEditor,
  openingBalance,
  onOpeningBalanceChange,
  hasBalanceAdjustment,
  onSubmittedChange,
  onRemarksChange,
  currentMonthExpectedMoney,
  thisMonthDatedSlotCount,
  feeTierBundle,
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
  const makeupDisplayN = resolveMakeupDisplayCount(
    makeupLiveCount,
    remedialCountDb,
    hasLessonPayload,
  );

  const paidLessonHintCount = tuitionPaidLessonHintCount({
    submitted: record.submitted,
    submittedLessonCount: record.submittedLessonCount,
    monthDatedSlotCount: thisMonthDatedSlotCount,
    expectedSessions: record.expected,
  });

  const gradeForOpening = inferGradeAtSheetEnd(
    student.grade,
    OPENING_BALANCE_AS_OF_YEAR,
    OPENING_BALANCE_AS_OF_MONTH,
  );
  const openingTier = resolveFeeTierSettingsForStudent(
    feeTierBundle,
    student.id,
    OPENING_BALANCE_AS_OF_YEAR,
    OPENING_BALANCE_AS_OF_MONTH,
  );
  const openingLessonHintCount = openingBalanceLessonHintCount({
    openingBalance,
    gradeForPricing: gradeForOpening,
    feeTierSettings: openingTier,
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
        title="該表月份的上課年級（9/1 升班前會顯示升班前年級）"
      >
        {formatGradeDisplay(sheetGrade) || "—"}
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
          {hasBalanceAdjustment ? (
            <span className="mt-0.5 block text-[9px] font-medium text-emerald-700">含調整／優惠</span>
          ) : null}
        </button>
      </td>
      {Array.from({ length: lColumnCount }, (_, i) => (
        <td key={i} className="px-2 py-3 text-center">
          <div
            className="min-h-7 rounded bg-slate-50 px-0.5 text-center text-[10px] leading-snug text-slate-800"
            style={{ width: L_COL_WIDTH - 8 }}
            title={lessonDates[i]?.includes("→") ? `補堂：${lessonDates[i]}` : lessonDates[i]}
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

