export type ProgressSheet = {
  name: string;
  headers: string[];
  rows: string[][];
};

export type StudentProgressWorkbookPayload = {
  sheets: ProgressSheet[];
  cutOffSheet: ProgressSheet | null;
  yearGradeThresholds: Record<number, number[]>;
};

export const CUT_OFF_SHEET = "Cut Off";
export const F6_BY_YEARS_SHEET = "F6 By Years";

const CUT_OFF_FIXED_LEVELS = ["5**", "5*", "5", "4", "3", "2"] as const;

export const DEFAULT_YEAR_GRADE_THRESHOLDS: Record<number, number[]> = {
  2026: [0, 33, 49, 62, 74, 83, 90],
  2025: [0, 33, 49, 62, 74, 83, 90],
  2024: [0, 33, 51, 76, 83, 89, 95],
  2023: [0, 33, 54, 59, 74, 82, 90],
  2022: [0, 49, 61, 68, 80, 87, 94],
  2021: [0, 36, 55, 62, 76, 84, 90],
  2020: [0, 36, 61, 62, 79, 87, 94],
  2019: [0, 36, 53, 65, 76, 84, 90],
  2018: [0, 36, 52, 63, 76, 83, 90],
  2017: [0, 36, 55, 67, 82, 87, 93],
  2016: [0, 36, 59, 66, 78, 86, 92],
  2015: [0, 36, 52, 65, 80, 87, 93],
  2014: [0, 36, 50, 65, 79, 87, 92],
  2013: [0, 36, 52, 61, 74, 81, 89],
  2012: [0, 36, 58, 67, 79, 82, 89],
};

export function parseGradeLevel(grade: string): number | null {
  const m = grade.trim().match(/^F\.?\s*([1-6])$/i);
  if (!m) return null;
  const level = Number(m[1]);
  return Number.isFinite(level) ? level : null;
}

export function getCumulativeSheetNames(level: number): string[] {
  const base: string[] = [];
  if (level >= 1) base.push("F1");
  if (level >= 2) base.push("F2");
  if (level >= 3) base.push("F3");
  if (level >= 4) base.push("F4");
  if (level >= 5) base.push("F5");
  if (level >= 6) base.push("F6 By Topics", "F6 By Years", "F6 學校mock卷", "Cut Off", "Exam Schedule");
  return base;
}

export function getCurrentGradeSheetNames(level: number): string[] {
  if (level <= 1) return ["F1"];
  if (level === 2) return ["F2"];
  if (level === 3) return ["F3"];
  if (level === 4) return ["F4"];
  if (level === 5) return ["F5"];
  return ["F6 By Topics", "F6 By Years", "F6 學校mock卷"];
}

function normalizeHeaderName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .trim();
}

function getProgressLevelKey(value: string): "remedial" | "good" | "mastered" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "remedial") return "remedial";
  if (normalized === "good") return "good";
  if (normalized === "mastered") return "mastered";
  return null;
}

function isLegendDataRow(row: string[]): boolean {
  return getProgressLevelKey(row[0] || "") !== null;
}

export function trimCutOffSheet(sheet: ProgressSheet): ProgressSheet {
  const rowByLevel = new Map<string, string[]>();
  const extraLevelRows: string[][] = [];
  for (const row of sheet.rows) {
    const level = String(row[0] ?? "").trim();
    if (!level) continue;
    if (CUT_OFF_FIXED_LEVELS.includes(level as (typeof CUT_OFF_FIXED_LEVELS)[number])) {
      rowByLevel.set(level, row);
    } else {
      extraLevelRows.push(row);
    }
  }
  const rows = [
    ...CUT_OFF_FIXED_LEVELS.map((level) => {
      const existing = rowByLevel.get(level);
      if (existing) {
        while (existing.length < sheet.headers.length) existing.push("");
        return existing;
      }
      return Array.from({ length: sheet.headers.length }, (_, index) => (index === 0 ? level : ""));
    }),
    ...extraLevelRows.map((row) => {
      const next = [...row];
      while (next.length < sheet.headers.length) next.push("");
      return next;
    }),
  ];
  return { ...sheet, rows };
}

function parsePercentFromCutoffCell(value: string): number | null {
  const m = value.match(/\((\d+(?:\.\d+)?)\)/);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function parseCutOffThresholds(rows: string[][]): Record<number, number[]> {
  if (!rows.length) return {};
  const header = rows[0] ?? [];
  const labelToRow = new Map<string, string[]>();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const label = String(row[0] ?? "").trim();
    if (label) labelToRow.set(label, row);
  }

  const out: Record<number, number[]> = {};
  for (let c = 1; c < header.length; c += 1) {
    const yearText = String(header[c] ?? "").trim();
    const yearMatch = yearText.match(/^(\d{4})/);
    if (!yearMatch) continue;
    const year = Number.parseInt(yearMatch[1], 10);
    if (!Number.isFinite(year)) continue;

    const p2 = parsePercentFromCutoffCell(String((labelToRow.get("2") ?? [])[c] ?? ""));
    const p3 = parsePercentFromCutoffCell(String((labelToRow.get("3") ?? [])[c] ?? ""));
    const p4 = parsePercentFromCutoffCell(String((labelToRow.get("4") ?? [])[c] ?? ""));
    const p5 = parsePercentFromCutoffCell(String((labelToRow.get("5") ?? [])[c] ?? ""));
    const p5s = parsePercentFromCutoffCell(String((labelToRow.get("5*") ?? [])[c] ?? ""));
    const p5ss = parsePercentFromCutoffCell(String((labelToRow.get("5**") ?? [])[c] ?? ""));
    if ([p2, p3, p4, p5, p5s, p5ss].some((v) => v === null)) continue;
    out[year] = [0, p2 as number, p3 as number, p4 as number, p5 as number, p5s as number, p5ss as number];
  }
  return out;
}

export function parseYear(value: string): number | null {
  const m = value.trim().match(/^\d{4}$/);
  if (!m) return null;
  const y = Number.parseInt(m[0], 10);
  return Number.isFinite(y) ? y : null;
}

function findHeaderColumnIndex(headers: string[], names: string[]): number {
  const wanted = new Set(names.map((name) => normalizeHeaderName(name)));
  return headers.findIndex((header) => wanted.has(normalizeHeaderName(header)));
}

function buildBlankF6ByYearsRow(headers: string[], dseColIndex: number, year: number): string[] {
  const row = Array.from({ length: headers.length }, () => "");
  row[dseColIndex] = String(year);
  const paper1Col = findHeaderColumnIndex(headers, ["paper 1"]);
  const percentCol = findHeaderColumnIndex(headers, ["%"]);
  const gradeCol = headers.findIndex((header) => normalizeHeaderName(header).startsWith("grade"));
  if (paper1Col >= 0) row[paper1Col] = "0";
  if (percentCol >= 0) row[percentCol] = "0";
  if (gradeCol >= 0) row[gradeCol] = "-";
  return row;
}

function extractCutOffYears(sheet: ProgressSheet): number[] {
  const years: number[] = [];
  for (let col = 1; col < sheet.headers.length; col += 1) {
    const yearMatch = String(sheet.headers[col] ?? "").trim().match(/^(\d{4})/);
    if (!yearMatch) continue;
    const year = Number.parseInt(yearMatch[1], 10);
    if (Number.isFinite(year)) years.push(year);
  }
  return years;
}

export function syncF6ByYearsWithCutOff(f6Sheet: ProgressSheet, cutOffSheet: ProgressSheet): ProgressSheet {
  const dseColIndex = findHeaderColumnIndex(f6Sheet.headers, ["dse"]);
  if (dseColIndex < 0) return f6Sheet;

  const cutOffYears = extractCutOffYears(cutOffSheet);
  const rowByYear = new Map<number, string[]>();
  const trailingRows: string[][] = [];

  for (const row of f6Sheet.rows) {
    const year = parseYear(String(row[dseColIndex] ?? ""));
    if (year !== null) {
      rowByYear.set(year, [...row]);
      continue;
    }
    if (isLegendDataRow(row)) {
      trailingRows.push([...row]);
    }
  }

  const syncedYearRows = cutOffYears.map((year, index) => {
    const existing = rowByYear.get(year) ?? buildBlankF6ByYearsRow(f6Sheet.headers, dseColIndex, year);
    const next = [...existing];
    while (next.length < f6Sheet.headers.length) next.push("");
    next[dseColIndex] = String(year);
    next[0] = index === 0 ? "F.6" : "";
    return next;
  });

  return { ...f6Sheet, rows: [...syncedYearRows, ...trailingRows] };
}

/** Build level payload from pre-parsed sheets (server-side xlsx read). */
export function buildProgressPayloadFromSheets(
  sheetsByName: ReadonlyMap<string, ProgressSheet>,
  level: number,
): StudentProgressWorkbookPayload {
  const wantedSheets = getCumulativeSheetNames(level);
  const parsed: ProgressSheet[] = [];

  const cutOffRaw = sheetsByName.get(CUT_OFF_SHEET) ?? null;
  const loadedCutOffSheet = cutOffRaw ? trimCutOffSheet(cutOffRaw) : null;

  for (const sheetName of wantedSheets) {
    const raw = sheetsByName.get(sheetName);
    if (!raw) continue;

    if (sheetName === CUT_OFF_SHEET && loadedCutOffSheet) {
      parsed.push(loadedCutOffSheet);
      continue;
    }

    let rows = raw.rows;
    if (sheetName === F6_BY_YEARS_SHEET && loadedCutOffSheet) {
      rows = syncF6ByYearsWithCutOff({ name: sheetName, headers: raw.headers, rows }, loadedCutOffSheet).rows;
    }
    parsed.push({ name: sheetName, headers: raw.headers, rows });
  }

  const yearGradeThresholds = loadedCutOffSheet
    ? {
        ...DEFAULT_YEAR_GRADE_THRESHOLDS,
        ...parseCutOffThresholds([loadedCutOffSheet.headers, ...loadedCutOffSheet.rows]),
      }
    : { ...DEFAULT_YEAR_GRADE_THRESHOLDS };

  return {
    sheets: parsed,
    cutOffSheet: loadedCutOffSheet,
    yearGradeThresholds,
  };
}
