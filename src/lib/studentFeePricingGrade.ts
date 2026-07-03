import { gradeRank, normalizeGradeCode } from "@/lib/grade";
import type { StudentFeeTierSettings } from "@/lib/studentFeeTierSettings";

/**
 * ISO date end of calendar month (UTC date parts; HK sheet months align with calendar month).
 */
export function monthEndIsoDate(year: number, month1to12: number): string {
  const day = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  return `${year}-${String(month1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function hkTodayIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  let y = "2026";
  let m = "01";
  let d = "01";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    if (p.type === "month") m = p.value;
    if (p.type === "day") d = p.value;
  }
  return `${y}-${m}-${d}`;
}

/**
 * Infer form level (F1..F6) at end of fee sheet month from **current** `students.grade`,
 * assuming one promotion per Sept 1 (HK) after that month-end until today.
 * If the student is not F1–F6, returns normalized code unchanged.
 */
export function inferGradeAtSheetEnd(currentGrade: string, sheetYear: number, sheetMonth: number): string {
  const code = normalizeGradeCode(currentGrade);
  const match = /^F([1-6])$/.exec(code);
  if (!match) return code;
  let level = Number(match[1]);
  const sheetEnd = monthEndIsoDate(sheetYear, sheetMonth);
  const today = hkTodayIso();

  let promotionsAfterSheet = 0;
  const minY = Math.min(sheetYear - 2, Number(sheetEnd.slice(0, 4)) - 1);
  const maxY = Number(today.slice(0, 4)) + 1;
  for (let y = minY; y <= maxY; y++) {
    const sept = `${y}-09-01`;
    if (sept > sheetEnd && sept <= today) promotionsAfterSheet += 1;
  }
  level = Math.max(1, Math.min(6, level - promotionsAfterSheet));
  return `F${level}`;
}

export function gradeForFeePricing(
  currentGrade: string,
  sheetYear: number,
  sheetMonth: number,
  feePricingGradeStored: string,
): string {
  const fgRaw = normalizeGradeCode(feePricingGradeStored);
  return /^F[1-6]$/.test(fgRaw) ? fgRaw : inferGradeAtSheetEnd(currentGrade, sheetYear, sheetMonth);
}

/** F1–F3 tier 第 1–N 堂 Normal 價（N = lesson_tier_break_after）；供提示用。 */
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

/** 按 L1→L9 有日期嘅順序，第 1–N 堂用高價、第 N+1 堂起用低價（N = tier.lesson_tier_break_after，預設 8）。 */
export function buildSlotPricesInLOrder(
  lessonDisplayDatesPerL: string[],
  gradeForPricing: string,
  tier: StudentFeeTierSettings,
): number[] {
  const low = isLowerFeeTier(gradeForPricing);
  const br = tier.lesson_tier_break_after;
  const hi = low ? tier.f_low_tier_1_8 : tier.f_high_tier_1_8;
  const lo = low ? tier.f_low_tier_9_plus : tier.f_high_tier_9_plus;
  const out: number[] = [];
  let lessonIdx = 0;
  for (let i = 0; i < lessonDisplayDatesPerL.length; i++) {
    const d = String(lessonDisplayDatesPerL[i] ?? "").trim();
    if (!d) continue;
    lessonIdx += 1;
    out.push(lessonIdx <= br ? hi : lo);
  }
  return out;
}

/** Sum tuition for dated slots in L-order using global F1–F3 / F4–F6 tier settings. */
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
  const br = Math.max(1, Math.floor(feeTierSettings.lesson_tier_break_after || 8));
  const low = isLowerFeeTier(gradeFor);
  const hi = low ? feeTierSettings.f_low_tier_1_8 : feeTierSettings.f_high_tier_1_8;
  const lo = low ? feeTierSettings.f_low_tier_9_plus : feeTierSettings.f_high_tier_9_plus;
  if (lessonCount <= br) return lessonCount * hi;
  return br * hi + (lessonCount - br) * lo;
}
