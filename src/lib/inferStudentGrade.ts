import { normalizeGradeCode } from "@/lib/grade";

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

/** Grade on a lesson date: same Sept-1 rollback as {@link inferGradeAtSheetEnd} for that date's month. */
export function inferGradeOnDate(currentGrade: string, dateIso: string): string {
  const iso = String(dateIso ?? "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return normalizeGradeCode(currentGrade);
  return inferGradeAtSheetEnd(currentGrade, Number(m[1]), Number(m[2]));
}
