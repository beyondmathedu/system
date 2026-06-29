/**
 * Lesson UI calendar year helpers (HK timezone).
 * Historical system start stays in lessonSystemStart.ts.
 */

import { readYmdParts } from "@/lib/intlFormatParts";
import { LESSON_SYSTEM_START_YEAR } from "@/lib/lessonSystemStart";

/** Earliest year selectable in lesson / fee UIs. */
export const MIN_LESSON_YEAR = LESSON_SYSTEM_START_YEAR;

export const MAX_LESSON_YEAR = 2099;

export function hkYmdNow(now = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const { y, m, d } = readYmdParts(parts, {
    y: String(MIN_LESSON_YEAR),
    m: "01",
    d: "01",
  });
  return {
    y: Number(y) || MIN_LESSON_YEAR,
    m: Number(m) || 1,
    d: Number(d) || 1,
  };
}

/** From 1 Dec (HK), allow picking the next calendar year in dropdowns. */
export function lessonYearPickerMax(now = new Date()): number {
  const { y, m, d } = hkYmdNow(now);
  const openNextYear = m === 12 && d >= 1;
  return openNextYear ? y + 1 : y;
}

/** Default lesson year when URL/query omits year. */
export function defaultLessonYear(now = new Date()): number {
  return Math.max(MIN_LESSON_YEAR, lessonYearPickerMax(now));
}

export function availableLessonYears(now = new Date()): number[] {
  const maxYear = lessonYearPickerMax(now);
  if (maxYear < MIN_LESSON_YEAR) return [MIN_LESSON_YEAR];
  return Array.from({ length: maxYear - MIN_LESSON_YEAR + 1 }, (_, i) => MIN_LESSON_YEAR + i);
}

export function parseLessonYear(raw: unknown, fallback = defaultLessonYear()): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  const y = Math.floor(n);
  if (y < MIN_LESSON_YEAR || y > MAX_LESSON_YEAR) return fallback;
  return y;
}

export function studentLessonsYearPath(studentId: string, year = defaultLessonYear()): string {
  return `/students/${encodeURIComponent(studentId)}/lessons/${year}`;
}
