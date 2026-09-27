import { readFile } from "node:fs/promises";
import path from "node:path";

export const TUITION_FEE_RECORD_EXCEL_RELATIVE = path.join(
  "data",
  "tuition-fee-record-2026.xlsx",
);

const MONTH_HEADER_TO_NUM: Record<string, number> = {
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export type TuitionFeeExcelCell = {
  studentKey: string;
  name: string;
  grade: string;
  month: number;
  amount: number;
};

export type TuitionFeeExcelParseResult = {
  year: number;
  cells: TuitionFeeExcelCell[];
  rowCount: number;
};

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function cellAmount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  const raw = String(value).trim();
  if (!raw || raw === "/" || raw === "-" || raw.toLowerCase() === "n/a") return 0;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Parse staff ground-truth workbook: Name | Grade | May…Dec amounts ("/" = 0). */
export async function parseTuitionFeeRecordExcel(
  absolutePath: string,
  year = 2026,
): Promise<TuitionFeeExcelParseResult> {
  const buffer = await readFile(absolutePath);
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName =
    workbook.SheetNames.find((n) => String(n).includes(String(year))) ?? workbook.SheetNames[0];
  if (!sheetName) {
    return { year, cells: [], rowCount: 0 };
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (!rows.length) return { year, cells: [], rowCount: 0 };

  const header = (rows[0] ?? []).map((v) => String(v ?? "").trim());
  const monthCols: Array<{ col: number; month: number }> = [];
  for (let col = 0; col < header.length; col += 1) {
    const key = header[col].toLowerCase();
    const month = MONTH_HEADER_TO_NUM[key];
    if (month) monthCols.push({ col, month });
  }

  const nameCol = header.findIndex((h) => /^name$/i.test(h));
  const gradeCol = header.findIndex((h) => /^grade$/i.test(h));
  const cells: TuitionFeeExcelCell[] = [];

  for (const row of rows.slice(1)) {
    const name = String(row[nameCol >= 0 ? nameCol : 0] ?? "").trim();
    if (!name || /^total$/i.test(name)) continue;
    const grade = String(row[gradeCol >= 0 ? gradeCol : 1] ?? "").trim();
    for (const { col, month } of monthCols) {
      const amount = cellAmount(row[col]);
      if (amount <= 0) continue;
      cells.push({
        studentKey: normalizeName(name.replace(/\s+/g, "")),
        name,
        grade,
        month,
        amount,
      });
    }
  }

  return { year, cells, rowCount: rows.length - 1 };
}

export function matchExcelNameToStudentId(
  excelName: string,
  students: Array<{ id: string; name_zh: string | null; name_en: string | null; nickname_en: string | null }>,
): string | null {
  const raw = String(excelName ?? "").trim();
  if (!raw) return null;
  const compact = normalizeName(raw.replace(/\s+/g, ""));
  const spaced = normalizeName(raw);

  for (const s of students) {
    const id = String(s.id ?? "").trim();
    if (!id) continue;
    const zh = String(s.name_zh ?? "").trim();
    const en = String(s.name_en ?? "").trim();
    const nick = String(s.nickname_en ?? "").trim();
    const variants = [
      zh,
      en,
      nick,
      `${zh}${en}`,
      `${zh}${nick}`,
      `${zh} ${en}`,
      `${zh} ${nick}`,
      `${zh}${en}`.replace(/\s+/g, ""),
      `${zh}${nick}`.replace(/\s+/g, ""),
    ]
      .map((v) => normalizeName(v.replace(/\s+/g, "")))
      .filter(Boolean);
    if (variants.includes(compact) || variants.includes(spaced.replace(/\s+/g, ""))) return id;
    if (zh && (raw.includes(zh) || compact.includes(normalizeName(zh)))) return id;
  }
  return null;
}
