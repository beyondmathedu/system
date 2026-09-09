/**
 * Academic Year helpers (HK): Sept 1 → next Aug 31.
 * Labels look like `2026-27`.
 */

export type AcademicYearId = string; // e.g. "2026-27"

/** Start calendar year of an academic year id (`2026-27` → 2026). */
export function academicYearStartYear(academicYear: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(academicYear ?? "").trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end2 = Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end2)) return null;
  if ((start + 1) % 100 !== end2) return null;
  return start;
}

export function formatAcademicYearId(startYear: number): AcademicYearId {
  const y = Math.trunc(startYear);
  return `${y}-${String(y + 1).slice(-2)}`;
}

/** Academic year containing a calendar month (1–12). */
export function getAcademicYearForMonth(year: number, month1to12: number): AcademicYearId {
  const y = Math.trunc(year);
  const m = Math.trunc(month1to12);
  const startYear = m >= 9 ? y : y - 1;
  return formatAcademicYearId(startYear);
}

/**
 * Academic year for a calendar date (YYYY-MM-DD preferred).
 * 2026-08-31 → 2025-26; 2026-09-01 → 2026-27.
 */
export function getAcademicYear(date: string | Date): AcademicYearId {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return formatAcademicYearId(new Date().getFullYear());
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    let y = "";
    let m = "";
    for (const p of parts) {
      if (p.type === "year") y = p.value;
      if (p.type === "month") m = p.value;
    }
    return getAcademicYearForMonth(Number(y), Number(m));
  }
  const iso = String(date ?? "").trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return formatAcademicYearId(new Date().getFullYear());
  return getAcademicYearForMonth(Number(match[1]), Number(match[2]));
}

/** Current academic year in Asia/Hong_Kong. */
export function getCurrentAcademicYear(now = new Date()): AcademicYearId {
  return getAcademicYear(now);
}

/** Promotion calendar year for an academic year (`2026-27` → 2026 = Sept 1 that starts it). */
export function promotionYearForAcademicYear(academicYear: string): number | null {
  return academicYearStartYear(academicYear);
}

export function academicYearLabelZh(academicYear: string): string {
  const start = academicYearStartYear(academicYear);
  if (start == null) return academicYear;
  return `${academicYear}（${start}/9–${start + 1}/8）`;
}
