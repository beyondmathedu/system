/**
 * Pure hydrate helper for /students-lesson-time-fee-record bootstrap payload.
 * Used by Server initial props and client month/year refetch.
 */

import { normalizeGradeCode } from "@/lib/grade";
import type { StudentFeeTierBundle } from "@/lib/studentFeeTierSettings";
import {
  FEE_OPENING_BALANCE_AS_OF_YEAR,
  readFeeOpeningBalancesFromLocal,
} from "@/lib/studentFeeOpeningBalance";
import type { StudentLesson2026State } from "@/lib/studentLessonStorage";
import type { StudentInactivePeriod } from "@/lib/studentVisibility";

const FEE_SYSTEM_START_YEAR = 2026;
const FEE_SYSTEM_START_MONTH = 5;

function feeSystemStartMonth1to12(sheetYear: number): number {
  return sheetYear === FEE_SYSTEM_START_YEAR ? FEE_SYSTEM_START_MONTH : 1;
}

export type FeeRecordBootstrapStudentRow = {
  id: string;
  name_zh: string;
  name_en: string;
  nickname_en: string;
  grade: string;
  student_phone: string;
  created_at: string;
};

export type FeeRecordBootstrapApiBody = {
  ok?: boolean;
  students?: FeeRecordBootstrapStudentRow[];
  metricsRows?: Array<{ student_id?: string; remedial_count?: number | null }>;
  feeRows?: Array<{
    student_id: string;
    year: number;
    month: number;
    submitted_amount: number;
    submitted_lesson_count?: number | null;
    lesson_unit_price: number | null;
    fee_pricing_grade: string | null;
    remarks: string;
    makeup_remarks: string;
    balance_due_remarks: string;
    send_fee: boolean;
  }>;
  recordsMap?: Record<string, unknown[]>;
  yearStatesMap?: Record<string, StudentLesson2026State>;
  openingResult?: {
    balances: Record<string, number>;
    error?: string;
    tableMissing?: boolean;
  };
  feeStartMonth?: number;
  endMonthForPricing?: number;
  visibilityByStudentId?: Record<string, { periods: StudentInactivePeriod[] }>;
  feeTierBundle?: StudentFeeTierBundle;
};

export type FeeRecordRecordState = {
  expected: number;
  submitted: number;
  submittedLessonCount: number | null;
  lessonUnitPrice: number;
  feePricingGrade: string;
  remarks: string;
  makeupRemarks: string;
  balanceDueRemarks: string;
  sendFee: boolean;
  lValues: number[];
};

export function defaultFeeRecordState(lCount = 9): FeeRecordRecordState {
  return {
    expected: 0,
    submitted: 0,
    submittedLessonCount: null,
    lessonUnitPrice: 0,
    feePricingGrade: "",
    remarks: "",
    makeupRemarks: "",
    balanceDueRemarks: "",
    sendFee: false,
    lValues: Array.from({ length: lCount }, () => 0),
  };
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

export type HydratedFeeRecordBootstrap = {
  students: FeeRecordBootstrapStudentRow[];
  visibilityByStudentId: Record<string, { periods: StudentInactivePeriod[] }>;
  remedialCountByStudentId: Record<string, number>;
  submittedByStudentMonth: Record<string, Partial<Record<number, number>>>;
  historicalMonthFeeByStudentId: Record<
    string,
    Partial<Record<number, { lessonUnitPrice: number; feePricingGrade: string }>>
  >;
  recordsByStudentId: Record<string, FeeRecordRecordState>;
  openingBalanceByStudentId: Record<string, number>;
  openingBalanceTableMissing: boolean;
  openingBalanceSaveMsg: string;
  lessonRecordsByStudentId: Record<string, unknown[]>;
  lessonYearStateByStudentId: Record<string, StudentLesson2026State>;
  feeTierBundle: StudentFeeTierBundle | null;
};

export function hydrateFeeRecordBootstrap(
  body: FeeRecordBootstrapApiBody,
  sheetYear: number,
  sheetMonth: number,
  options?: { mergeLocalOpeningBalances?: boolean; lCount?: number },
): HydratedFeeRecordBootstrap {
  const mergeLocal = options?.mergeLocalOpeningBalances !== false;
  const lCount = options?.lCount ?? 9;
  const mapped = body.students ?? [];
  const visibilityByStudentId = body.visibilityByStudentId ?? {};
  const currentMonth = Number(sheetMonth);
  const feeStartMonth = body.feeStartMonth ?? feeSystemStartMonth1to12(sheetYear);
  const endMonthForPricing = body.endMonthForPricing ?? currentMonth - 1;
  const feeRows = body.feeRows ?? [];
  const recordsMap = body.recordsMap ?? {};
  const yearStatesMap = body.yearStatesMap ?? {};

  const recordsByStudentId: Record<string, FeeRecordRecordState> = {};
  for (const st of mapped) {
    recordsByStudentId[st.id] = defaultFeeRecordState(lCount);
  }

  const remedialCountByStudentId: Record<string, number> = {};
  for (const row of body.metricsRows ?? []) {
    remedialCountByStudentId[String(row.student_id ?? "")] = Number(row.remedial_count ?? 0) || 0;
  }

  const submittedByStudentMonth: Record<string, Partial<Record<number, number>>> = {};
  const historicalMonthFeeByStudentId: Record<
    string,
    Partial<Record<number, { lessonUnitPrice: number; feePricingGrade: string }>>
  > = {};

  if (endMonthForPricing >= feeStartMonth) {
    for (const row of feeRows) {
      const mo = row.month;
      if (mo < feeStartMonth || mo > endMonthForPricing) continue;
      const sid = row.student_id;
      if (!sid || !mo) continue;
      if (!historicalMonthFeeByStudentId[sid]) historicalMonthFeeByStudentId[sid] = {};
      const rawG = String(row.fee_pricing_grade ?? "").trim();
      const c = normalizeGradeCode(rawG);
      historicalMonthFeeByStudentId[sid][mo] = {
        lessonUnitPrice: Number(row.lesson_unit_price ?? 0) || 0,
        feePricingGrade: /^F[1-6]$/.test(c) ? c : "",
      };
    }
  }

  for (const row of feeRows) {
    const sid = row.student_id;
    const mo = row.month;
    if (!sid || !mo || mo < feeStartMonth || mo > currentMonth) continue;
    if (!submittedByStudentMonth[sid]) submittedByStudentMonth[sid] = {};
    submittedByStudentMonth[sid][mo] = Number(row.submitted_amount ?? 0) || 0;
  }

  for (const r of feeRows) {
    if (r.month !== currentMonth) continue;
    const id = r.student_id;
    if (!recordsByStudentId[id]) recordsByStudentId[id] = defaultFeeRecordState(lCount);
    recordsByStudentId[id] = {
      ...recordsByStudentId[id],
      submitted: Number(r.submitted_amount ?? 0) || 0,
      submittedLessonCount:
        r.submitted_lesson_count == null || Number.isNaN(Number(r.submitted_lesson_count))
          ? null
          : Number(r.submitted_lesson_count),
      lessonUnitPrice: Number(r.lesson_unit_price ?? 0) || 0,
      feePricingGrade: (() => {
        const raw = String(r.fee_pricing_grade ?? "").trim();
        const c = normalizeGradeCode(raw);
        return /^F[1-6]$/.test(c) ? c : "";
      })(),
      remarks: String(r.remarks ?? ""),
      makeupRemarks: String(r.makeup_remarks ?? ""),
      balanceDueRemarks: String(r.balance_due_remarks ?? ""),
      sendFee: Boolean(r.send_fee),
    };
  }

  let openingBalanceByStudentId: Record<string, number> = {};
  let openingBalanceTableMissing = false;
  let openingBalanceSaveMsg = "";
  if (sheetYear === FEE_OPENING_BALANCE_AS_OF_YEAR) {
    const openingResult = body.openingResult ?? { balances: {} };
    const local = mergeLocal && typeof window !== "undefined" ? readFeeOpeningBalancesFromLocal() : {};
    // DB first, then local backup when cloud write failed or page reloaded before save finished.
    openingBalanceByStudentId = { ...openingResult.balances, ...local };
    openingBalanceTableMissing = Boolean(openingResult.tableMissing);
    if (openingResult.error) {
      openingBalanceSaveMsg = openingResult.tableMissing
        ? "期初結餘表未建立：請在 Supabase 執行 supabase/supabase_student_fee_opening_balances.sql（已暫存本機）"
        : `期初結餘讀取失敗：${openingResult.error}（已用本機備份）`;
    }
  }

  const lessonRecordsByStudentId: Record<string, unknown[]> = {};
  const lessonYearStateByStudentId: Record<string, StudentLesson2026State> = {};
  for (const st of mapped) {
    const id = st.id;
    const rawCloudRecords = recordsMap[id];
    lessonRecordsByStudentId[id] = Array.isArray(rawCloudRecords) ? rawCloudRecords : [];
    lessonYearStateByStudentId[id] = yearStatesMap[id] ?? emptyLessonYearState();
  }

  return {
    students: mapped,
    visibilityByStudentId,
    remedialCountByStudentId,
    submittedByStudentMonth,
    historicalMonthFeeByStudentId:
      endMonthForPricing >= feeStartMonth ? historicalMonthFeeByStudentId : {},
    recordsByStudentId,
    openingBalanceByStudentId,
    openingBalanceTableMissing,
    openingBalanceSaveMsg,
    lessonRecordsByStudentId,
    lessonYearStateByStudentId,
    feeTierBundle: body.feeTierBundle ?? null,
  };
}
