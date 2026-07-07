import { isF6Grade } from "@/lib/grade";

/**
 * 學生可見性規則：
 * - 手動 Inactive（student_visibility_modes）沿用既有邏輯；
 * - F.6 學生自該年 05-01 起自動視為 Inactive（畢業）。
 * 回傳最早生效日（字串 YYYY-MM-DD 可直接做 lexicographical compare）。
 */
export function normalizeOptionalIsoDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function daysBetweenIso(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00+08:00`);
  const end = Date.parse(`${endIso}T00:00:00+08:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Detail line for home dashboard inactive-return reminders. */
export function formatStudentReactivateReminderDetail(reactivateDate: string, ymdToday: string): string {
  if (reactivateDate === ymdToday) {
    return "今日預計恢復上堂 — 請到 Lessons 改回 Active";
  }
  if (reactivateDate < ymdToday) {
    const days = daysBetweenIso(reactivateDate, ymdToday);
    return `已過預計復課日 ${reactivateDate}（${days} 天前）— 仍未改回 Active`;
  }
  const daysUntil = daysBetweenIso(ymdToday, reactivateDate);
  if (daysUntil === 1) return `明天（${reactivateDate}）恢復上堂 — 請預留改回 Active`;
  return `${daysUntil} 日後恢復（${reactivateDate}）— 請預留改回 Active 及課表`;
}

export function compareStudentReactivateReminders(a: string, b: string, ymdToday: string): number {
  const rank = (iso: string) => {
    if (iso < ymdToday) return 0;
    if (iso === ymdToday) return 1;
    return 2;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}
export function resolveStudentInactiveEffectiveDate(input: {
  grade?: string | null;
  manualInactiveEffective?: string | null;
  year: number;
}): string | null {
  const manual = String(input.manualInactiveEffective ?? "").trim() || null;
  const auto = isF6Grade(input.grade) ? `${input.year}-05-01` : null;
  if (manual && auto) return manual < auto ? manual : auto;
  return manual || auto;
}

function monthEndIsoDate(year: number, month1to12: number): string {
  const day = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  return `${year}-${String(month1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function firstDayOfNextMonthIso(year: number, month1to12: number): string {
  if (month1to12 === 12) return `${year + 1}-01-01`;
  return `${year}-${String(month1to12 + 1).padStart(2, "0")}-01`;
}

/**
 * Expected return = first day BACK at lessons.
 * If stored as the last day of a month (common when pausing through end of August),
 * treat as the 1st of the following month so the whole pause month stays fee-free.
 */
export function normalizeReactivateAsFirstActiveDay(reactivate: string | null | undefined): string | null {
  const r = normalizeOptionalIsoDate(reactivate);
  if (!r) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r);
  if (!m) return r;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (r === monthEndIsoDate(y, mo)) return firstDayOfNextMonthIso(y, mo);
  return r;
}

function resolveReactivateForInactiveLogic(reactivate: string | null | undefined): string | null {
  return normalizeReactivateAsFirstActiveDay(reactivate);
}

export type StudentVisibilityMaps = {
  inactiveEffectiveById: Record<string, string>;
  reactivateDateById: Record<string, string | null>;
};

export function buildStudentVisibilityMaps(
  rows: Array<{
    student_id?: string;
    mode?: string;
    effective_date?: string;
    reactivate_date?: string | null;
  }>,
): StudentVisibilityMaps {
  const inactiveEffectiveById: Record<string, string> = {};
  const reactivateDateById: Record<string, string | null> = {};
  for (const row of rows) {
    const mode = String(row.mode ?? "active").toLowerCase();
    if (mode !== "inactive") continue;
    const sid = String(row.student_id ?? "").trim();
    const eff = String(row.effective_date ?? "").trim();
    if (!sid || !eff) continue;
    inactiveEffectiveById[sid] = eff;
    reactivateDateById[sid] = normalizeOptionalIsoDate(row.reactivate_date);
  }
  return { inactiveEffectiveById, reactivateDateById };
}

/** True on/after manual inactive effective until reactivate date (if any). F6 auto-inactive included. */
export function isStudentInactiveOnDate(input: {
  grade?: string | null;
  manualInactiveEffective?: string | null;
  reactivateDate?: string | null;
  year: number;
  dateIso: string;
}): boolean {
  const eff = resolveStudentInactiveEffectiveDate({
    grade: input.grade,
    manualInactiveEffective: input.manualInactiveEffective,
    year: input.year,
  });
  if (!eff || input.dateIso < eff) return false;
  const reactivate = resolveReactivateForInactiveLogic(input.reactivateDate);
  if (reactivate && input.dateIso >= reactivate) return false;
  return true;
}

export type InactiveMonthGap = {
  /** Last visible month before this inactive block (0 if none). */
  afterMonth: number;
  months: number[];
  effectiveDate: string;
  reactivateDate: string | null;
};

/** Whole calendar months with no lessons because the student is inactive (for lesson table gaps). */
export function getInactiveMonthGapsInYear(input: {
  grade?: string | null;
  manualInactiveEffective?: string | null;
  reactivateDate?: string | null;
  year: number;
  firstMonth?: number;
}): InactiveMonthGap[] {
  const eff = resolveStudentInactiveEffectiveDate({
    grade: input.grade,
    manualInactiveEffective: input.manualInactiveEffective,
    year: input.year,
  });
  if (!eff) return [];

  const reactivate = normalizeReactivateAsFirstActiveDay(input.reactivateDate);
  const startMonth = input.firstMonth ?? 1;
  const fullyInactive: number[] = [];

  for (let m = startMonth; m <= 12; m++) {
    const monthStart = `${input.year}-${String(m).padStart(2, "0")}-01`;
    const monthEnd = monthEndIsoDate(input.year, m);
    if (monthStart >= eff && (!reactivate || monthEnd < reactivate)) {
      fullyInactive.push(m);
    }
  }

  if (fullyInactive.length === 0) return [];

  const gaps: InactiveMonthGap[] = [];
  let group: number[] = [fullyInactive[0]!];

  for (let i = 1; i < fullyInactive.length; i++) {
    const month = fullyInactive[i]!;
    if (month === group[group.length - 1]! + 1) {
      group.push(month);
      continue;
    }
    gaps.push({
      afterMonth: group[0]! - 1,
      months: group,
      effectiveDate: eff,
      reactivateDate: reactivate,
    });
    group = [month];
  }

  gaps.push({
    afterMonth: group[0]! - 1,
    months: group,
    effectiveDate: eff,
    reactivateDate: reactivate,
  });

  return gaps;
}

/** Returns a date checker for fee/lesson billing, or undefined when the student has no manual inactive date. */
export function makeStudentInactiveDateChecker(input: {
  grade?: string | null;
  manualInactiveEffective?: string | null;
  reactivateDate?: string | null;
  year: number;
}): ((dateIso: string) => boolean) | undefined {
  const eff = String(input.manualInactiveEffective ?? "").trim();
  if (!eff) return undefined;
  return (dateIso: string) =>
    isStudentInactiveOnDate({
      grade: input.grade,
      manualInactiveEffective: eff,
      reactivateDate: input.reactivateDate,
      year: input.year,
      dateIso,
    });
}

/** Fee sheet month: hide only while pause covers that month; show again from reactivate month onward. */
export function isStudentHiddenForFeeSheetMonth(input: {
  grade?: string | null;
  manualInactiveEffective?: string | null;
  reactivateDate?: string | null;
  sheetYear: number;
  sheetMonth: number;
}): boolean {
  const monthEnd = monthEndIsoDate(input.sheetYear, input.sheetMonth);
  const eff = resolveStudentInactiveEffectiveDate({
    grade: input.grade,
    manualInactiveEffective: input.manualInactiveEffective,
    year: input.sheetYear,
  });
  if (!eff || eff > monthEnd) return false;
  const reactivate = resolveReactivateForInactiveLogic(input.reactivateDate);
  if (reactivate && reactivate <= monthEnd) return false;
  return true;
}
