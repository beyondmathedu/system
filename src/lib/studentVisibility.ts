import { isF6Grade } from "@/lib/grade";

/**
 * 學生可見性規則：
 * - 手動 Inactive（legacy: student_visibility_modes；new: student_visibility_periods）；
 * - F.6 學生自該年 05-01 起自動視為 Inactive（畢業）。
 *
 * NOTE: The codebase previously assumed a single inactive effective date per student.
 * This module now supports multiple inactive periods while keeping legacy helpers
 * for backwards compatibility.
 */
export function normalizeOptionalIsoDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export type StudentInactivePeriod = {
  studentId: string;
  /** Inclusive start (YYYY-MM-DD). */
  startDate: string;
  /** Exclusive end = first active day (YYYY-MM-DD), or null for indefinite. */
  endDate: string | null;
  note?: string;
};

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

function isoIsValid(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? "").trim());
}

function isIsoDateInHalfOpenRange(dateIso: string, startIso: string, endIso: string | null): boolean {
  if (!isoIsValid(dateIso) || !isoIsValid(startIso)) return false;
  if (dateIso < startIso) return false;
  const end = endIso ? normalizeOptionalIsoDate(endIso) : null;
  if (end && dateIso >= end) return false;
  return true;
}

function sortAndCoalescePeriods(periods: StudentInactivePeriod[]): StudentInactivePeriod[] {
  const normalized = periods
    .map((p) => ({
      studentId: String(p.studentId ?? "").trim(),
      startDate: String(p.startDate ?? "").trim(),
      endDate: normalizeOptionalIsoDate(p.endDate),
      note: typeof p.note === "string" ? p.note : undefined,
    }))
    .filter((p) => isoIsValid(p.startDate));

  normalized.sort((a, b) => {
    const sd = a.startDate.localeCompare(b.startDate);
    if (sd !== 0) return sd;
    const ea = a.endDate ?? "9999-12-31";
    const eb = b.endDate ?? "9999-12-31";
    return ea.localeCompare(eb);
  });

  const out: StudentInactivePeriod[] = [];
  for (const p of normalized) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(p);
      continue;
    }
    if (last.studentId !== p.studentId) {
      out.push(p);
      continue;
    }

    const lastEnd = last.endDate;
    const pEnd = p.endDate;
    const lastEndComparable = lastEnd ?? "9999-12-31";

    // Overlap / touch: merge into last.
    if (p.startDate <= lastEndComparable) {
      const mergedEnd =
        lastEnd == null || pEnd == null
          ? null
          : pEnd > lastEnd
            ? pEnd
            : lastEnd;
      last.endDate = mergedEnd;
      continue;
    }
    out.push(p);
  }
  return out;
}

export function isStudentInactiveOnDateFromPeriods(input: {
  periods: readonly StudentInactivePeriod[];
  dateIso: string;
}): boolean {
  const dateIso = String(input.dateIso ?? "").trim();
  const periods = input.periods ?? [];
  // periods are expected small; linear scan is fine, but allow pre-coalesced.
  for (const p of periods) {
    if (isIsoDateInHalfOpenRange(dateIso, p.startDate, p.endDate)) return true;
  }
  return false;
}

export function autoF6InactivePeriod(input: {
  studentId: string;
  grade?: string | null;
  year: number;
}): StudentInactivePeriod | null {
  if (!isF6Grade(input.grade)) return null;
  return {
    studentId: String(input.studentId ?? "").trim(),
    startDate: `${input.year}-05-01`,
    endDate: null,
    note: "auto: F6 graduation",
  };
}

export function withAutoF6InactivePeriod(input: {
  periods: readonly StudentInactivePeriod[];
  studentId: string;
  grade?: string | null;
  year: number;
}): StudentInactivePeriod[] {
  const auto = autoF6InactivePeriod(input);
  const merged = auto ? [...input.periods, auto] : [...input.periods];
  return sortAndCoalescePeriods(merged);
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

function monthStartIsoDate(year: number, month1to12: number): string {
  return `${year}-${String(month1to12).padStart(2, "0")}-01`;
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
  const manualPeriod: StudentInactivePeriod[] = eff
    ? [
        {
          studentId: "",
          startDate: eff,
          endDate: resolveReactivateForInactiveLogic(input.reactivateDate),
        },
      ]
    : [];
  const periods = withAutoF6InactivePeriod({
    periods: manualPeriod,
    studentId: "",
    grade: input.grade,
    year: input.year,
  });
  return isStudentInactiveOnDateFromPeriods({ periods, dateIso: input.dateIso });
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
  const manualPeriod: StudentInactivePeriod[] = eff
    ? [
        {
          studentId: "",
          startDate: eff,
          endDate: normalizeReactivateAsFirstActiveDay(input.reactivateDate),
        },
      ]
    : [];
  const periods = withAutoF6InactivePeriod({
    periods: manualPeriod,
    studentId: "",
    grade: input.grade,
    year: input.year,
  });
  if (!periods.length) return [];

  const startMonth = input.firstMonth ?? 1;
  const fullyInactive: number[] = [];
  for (let m = startMonth; m <= 12; m++) {
    const monthStart = monthStartIsoDate(input.year, m);
    const monthEndExclusive = firstDayOfNextMonthIso(input.year, m);
    if (isIsoRangeFullyInactive({ periods, startIso: monthStart, endExclusiveIso: monthEndExclusive })) {
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
      effectiveDate: periods[0]!.startDate,
      reactivateDate: periods[0]!.endDate,
    });
    group = [month];
  }

  gaps.push({
    afterMonth: group[0]! - 1,
    months: group,
    effectiveDate: periods[0]!.startDate,
    reactivateDate: periods[0]!.endDate,
  });

  return gaps;
}

function isIsoRangeFullyInactive(input: {
  periods: readonly StudentInactivePeriod[];
  startIso: string;
  endExclusiveIso: string;
}): boolean {
  const start = String(input.startIso ?? "").trim();
  const end = String(input.endExclusiveIso ?? "").trim();
  if (!isoIsValid(start) || !isoIsValid(end) || end <= start) return false;
  const coalesced = sortAndCoalescePeriods([...input.periods]);
  // Filter to periods that might overlap [start,end)
  const relevant = coalesced.filter((p) => {
    const pEnd = p.endDate ?? "9999-12-31";
    return p.startDate < end && pEnd > start;
  });
  if (!relevant.length) return false;

  // Walk coverage from start to end.
  let cursor = start;
  for (const p of relevant) {
    const pEnd = p.endDate ?? "9999-12-31";
    if (pEnd <= cursor) continue;
    if (p.startDate > cursor) return false; // gap before next coverage
    cursor = pEnd;
    if (cursor >= end) return true;
  }
  return cursor >= end;
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

export function makeStudentInactiveDateCheckerFromPeriods(input: {
  periods: readonly StudentInactivePeriod[];
  studentId: string;
  grade?: string | null;
  year: number;
}): (dateIso: string) => boolean {
  const periods = withAutoF6InactivePeriod({
    periods: input.periods,
    studentId: input.studentId,
    grade: input.grade,
    year: input.year,
  });
  return (dateIso: string) => isStudentInactiveOnDateFromPeriods({ periods, dateIso });
}

/** Fee sheet month: hide only while pause covers that month; show again from reactivate month onward. */
export function isStudentHiddenForFeeSheetMonth(input: {
  grade?: string | null;
  manualInactiveEffective?: string | null;
  reactivateDate?: string | null;
  sheetYear: number;
  sheetMonth: number;
}): boolean {
  const eff = resolveStudentInactiveEffectiveDate({
    grade: input.grade,
    manualInactiveEffective: input.manualInactiveEffective,
    year: input.sheetYear,
  });
  const manualPeriod: StudentInactivePeriod[] = eff
    ? [
        {
          studentId: "",
          startDate: eff,
          endDate: resolveReactivateForInactiveLogic(input.reactivateDate),
        },
      ]
    : [];
  const periods = withAutoF6InactivePeriod({
    periods: manualPeriod,
    studentId: "",
    grade: input.grade,
    year: input.sheetYear,
  });
  if (!periods.length) return false;

  const monthStart = monthStartIsoDate(input.sheetYear, input.sheetMonth);
  const monthEndExclusive = firstDayOfNextMonthIso(input.sheetYear, input.sheetMonth);
  return isIsoRangeFullyInactive({ periods, startIso: monthStart, endExclusiveIso: monthEndExclusive });
}

export function isStudentHiddenForFeeSheetMonthFromPeriods(input: {
  periods: readonly StudentInactivePeriod[];
  studentId: string;
  grade?: string | null;
  sheetYear: number;
  sheetMonth: number;
}): boolean {
  const periods = withAutoF6InactivePeriod({
    periods: input.periods,
    studentId: input.studentId,
    grade: input.grade,
    year: input.sheetYear,
  });
  if (!periods.length) return false;
  const monthStart = monthStartIsoDate(input.sheetYear, input.sheetMonth);
  const monthEndExclusive = firstDayOfNextMonthIso(input.sheetYear, input.sheetMonth);
  return isIsoRangeFullyInactive({ periods, startIso: monthStart, endExclusiveIso: monthEndExclusive });
}

export type StudentInactivePeriodsById = Record<string, StudentInactivePeriod[]>;

export function buildStudentInactivePeriodsById(
  rows: Array<{
    student_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    note?: string | null;
  }>,
): StudentInactivePeriodsById {
  const byId: StudentInactivePeriodsById = {};
  for (const row of rows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    const start = normalizeOptionalIsoDate(row.start_date);
    const end = normalizeOptionalIsoDate(row.end_date);
    if (!sid || !start) continue;
    const p: StudentInactivePeriod = {
      studentId: sid,
      startDate: start,
      endDate: end,
      ...(row.note ? { note: String(row.note) } : {}),
    };
    (byId[sid] ??= []).push(p);
  }
  for (const sid of Object.keys(byId)) {
    byId[sid] = sortAndCoalescePeriods(byId[sid]!);
  }
  return byId;
}
