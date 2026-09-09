import { gradeRank, normalizeGradeCode } from "@/lib/grade";
import { studentIdInCurrentPriceList } from "@/lib/studentId";
import type { StudentFeeTierBundle, StudentFeeTierSettings } from "@/lib/studentFeeTierSettings";
import { monthEndIsoDate } from "@/lib/inferStudentGrade";
import {
  getStudentGradeForMonth,
  type GradeHistoryByAcademicYear,
} from "@/lib/studentGradeHistory";

export {
  inferGradeAtSheetEnd,
  inferGradeOnDate,
  monthEndIsoDate,
} from "@/lib/inferStudentGrade";

export {
  getStudentGradeForDate,
  getStudentGradeForMonth,
} from "@/lib/studentGradeHistory";

/** HK calendar YYYY-MM-DD from ISO timestamp or date string. */
export function studentCreatedAtToHkIsoDate(createdAt: string | number | Date | null | undefined): string {
  if (createdAt == null || createdAt === "") return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  let y = "";
  let m = "";
  let day = "";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    if (p.type === "month") m = p.value;
    if (p.type === "day") day = p.value;
  }
  return y && m && day ? `${y}-${m}-${day}` : "";
}

/**
 * Pick legacy vs current tier table for a student/month.
 * - Month-end >= global switch → current for everyone.
 * - Else student id is in currentPriceStudentIds list → current.
 * - Else → legacy (default for existing + referral students).
 */
export function resolveFeeTierSettingsForStudent(
  bundle: StudentFeeTierBundle,
  studentId: string,
  sheetYear: number,
  sheetMonth: number,
): StudentFeeTierSettings {
  const sheetEnd = monthEndIsoDate(sheetYear, sheetMonth);
  if (sheetEnd >= bundle.globalPriceSwitchDate) {
    return { ...bundle.current, lesson_tier_break_after: bundle.legacy.lesson_tier_break_after };
  }
  if (studentIdInCurrentPriceList(studentId, bundle.currentPriceStudentIds)) {
    return { ...bundle.current, lesson_tier_break_after: bundle.legacy.lesson_tier_break_after };
  }
  return { ...bundle.legacy };
}

export function gradeForFeePricing(
  currentGrade: string,
  sheetYear: number,
  sheetMonth: number,
  feePricingGradeStored: string,
  heldBackYears?: ReadonlySet<number> | readonly number[] | null,
  historyByAcademicYear?: GradeHistoryByAcademicYear | null,
): string {
  const fgRaw = normalizeGradeCode(feePricingGradeStored);
  if (/^F[1-6]$/.test(fgRaw)) return fgRaw;
  return getStudentGradeForMonth({
    currentGrade,
    sheetYear,
    sheetMonth,
    historyByAcademicYear,
    heldBackYears,
  });
}

/** F1–F3 / F4–F6 Normal unit price；供提示用。 */
export function tierNormalLessonUnitPrice(
  gradeForPricing: string,
  tier: StudentFeeTierSettings,
): number {
  return isLowerFeeTier(gradeForPricing) ? tier.f_low_tier_1_8 : tier.f_high_tier_1_8;
}

/** F1–F3 = lower tuition tier; F4–F6 = higher. */
export function isLowerFeeTier(grade: string): boolean {
  const r = gradeRank(grade);
  if (r === Number.MAX_SAFE_INTEGER) return true;
  return r <= 3;
}

/**
 * Monthly threshold pricing (whole month one rate):
 * - dated lessons < break (default 8 → ≤7): every slot Normal
 * - dated lessons ≥ break (default 8): every slot Discount
 */
export function monthLessonUnitPrice(
  lessonCount: number,
  gradeForPricing: string,
  tier: StudentFeeTierSettings,
): number {
  const br = Math.max(1, Math.floor(tier.lesson_tier_break_after || 8));
  const low = isLowerFeeTier(gradeForPricing);
  const hi = low ? tier.f_low_tier_1_8 : tier.f_high_tier_1_8;
  const lo = low ? tier.f_low_tier_9_plus : tier.f_high_tier_9_plus;
  if (!Number.isFinite(lessonCount) || lessonCount <= 0) return hi;
  return lessonCount >= br ? lo : hi;
}

/** 按 L1→L9 有日期嘅順序；本月總堂數決定全部用 Normal 定全部 Discount。 */
export function buildSlotPricesInLOrder(
  lessonDisplayDatesPerL: string[],
  gradeForPricing: string,
  tier: StudentFeeTierSettings,
): number[] {
  const dated: string[] = [];
  for (const raw of lessonDisplayDatesPerL) {
    const d = String(raw ?? "").trim();
    if (d) dated.push(d);
  }
  const unit = monthLessonUnitPrice(dated.length, gradeForPricing, tier);
  return dated.map(() => unit);
}

/** Sum tuition for dated slots using global F1–F3 / F4–F6 tier settings. */
export function sumSlotTuitionHkdFromDates(params: {
  fullLessonDates: string[];
  gradeFor: string;
  feeTierSettings: StudentFeeTierSettings;
}): number {
  const slotPrices = buildSlotPricesInLOrder(
    params.fullLessonDates,
    params.gradeFor,
    params.feeTierSettings,
  );
  return slotPrices.reduce((a, b) => a + b, 0);
}

/** Sum tuition when only lesson count is known (weekday estimate, Zoho qty, etc.). */
export function sumSlotTuitionHkdByLessonCount(params: {
  lessonCount: number;
  gradeFor: string;
  feeTierSettings: StudentFeeTierSettings;
}): number {
  const { lessonCount, gradeFor, feeTierSettings } = params;
  if (!Number.isFinite(lessonCount) || lessonCount <= 0) return 0;
  return lessonCount * monthLessonUnitPrice(lessonCount, gradeFor, feeTierSettings);
}
