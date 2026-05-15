/** 網站課表／補堂由這個月起；之前 Excel 年代唔在此顯示或統計。 */
export const LESSON_SYSTEM_START_YEAR = 2026;
export const LESSON_SYSTEM_START_MONTH = 5;

export const LESSON_SYSTEM_START_LABEL_ZH = `${LESSON_SYSTEM_START_YEAR} 年 ${LESSON_SYSTEM_START_MONTH} 月`;

export function getLessonSystemStartIso(calendarYear: number): string {
  const month =
    calendarYear === LESSON_SYSTEM_START_YEAR ? LESSON_SYSTEM_START_MONTH : 1;
  return `${calendarYear}-${String(month).padStart(2, "0")}-01`;
}

export function getLessonSystemStartDate(calendarYear: number): Date {
  const monthIndex =
    calendarYear === LESSON_SYSTEM_START_YEAR ? LESSON_SYSTEM_START_MONTH - 1 : 0;
  return new Date(calendarYear, monthIndex, 1);
}

export function isOnOrAfterLessonSystemStart(dateIso: string, calendarYear: number): boolean {
  return dateIso >= getLessonSystemStartIso(calendarYear);
}

/** 將日期區間下限夾在課表系統起點；若整段都在起點之前則回傳 null。 */
export function clampDateRangeToLessonSystemStart(
  startIso: string,
  endIso: string,
  calendarYear: number,
): { startIso: string; endIso: string } | null {
  const minStart = getLessonSystemStartIso(calendarYear);
  const start = startIso < minStart ? minStart : startIso;
  if (start > endIso) return null;
  return { startIso: start, endIso };
}
