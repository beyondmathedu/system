/** 網站課表／補堂由這個月起；之前 Excel 年代唔在此顯示或統計。 */
export const LESSON_SYSTEM_START_YEAR = 2026;
export const LESSON_SYSTEM_START_MONTH = 5;

export const LESSON_SYSTEM_START_LABEL_ZH = `${LESSON_SYSTEM_START_YEAR} 年 ${LESSON_SYSTEM_START_MONTH} 月`;

export function getLessonSystemStartIso(calendarYear: number): string {
  const month =
    calendarYear === LESSON_SYSTEM_START_YEAR ? LESSON_SYSTEM_START_MONTH : 1;
  return `${calendarYear}-${String(month).padStart(2, "0")}-01`;
}

/**
 * 將 YYYY-M-D 或 YYYY-MM-DD 統一成 YYYY-MM-DD，供字串比較。
 * 未補零日期（如 2026-4-9）若直接用 >= 與 2026-05-01 比較會誤判為「較大」。
 */
export function normalizeCalendarDateIso(raw: string): string | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function getLessonSystemStartDate(calendarYear: number): Date {
  const monthIndex =
    calendarYear === LESSON_SYSTEM_START_YEAR ? LESSON_SYSTEM_START_MONTH - 1 : 0;
  return new Date(calendarYear, monthIndex, 1);
}

export function isOnOrAfterLessonSystemStart(dateIso: string, calendarYear: number): boolean {
  const n = normalizeCalendarDateIso(dateIso);
  if (!n) return false;
  return n >= getLessonSystemStartIso(calendarYear);
}

/** 將日期區間下限夾在課表系統起點；若整段都在起點之前則回傳 null。 */
export function clampDateRangeToLessonSystemStart(
  startIso: string,
  endIso: string,
  calendarYear: number,
): { startIso: string; endIso: string } | null {
  const ns = normalizeCalendarDateIso(startIso) ?? startIso;
  const ne = normalizeCalendarDateIso(endIso) ?? endIso;
  const minStart = getLessonSystemStartIso(calendarYear);
  const start = ns < minStart ? minStart : ns;
  if (start > ne) return null;
  return { startIso: start, endIso: ne };
}
