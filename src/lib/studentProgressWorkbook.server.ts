import { readFile } from "node:fs/promises";
import path from "node:path";
import { unstable_cache } from "next/cache";
import {
  buildProgressPayloadFromSheets,
  M1_SHEET,
  M2_SHEET,
  type ExtendedMathsOptions,
  type ProgressSheet,
  type StudentProgressWorkbookPayload,
} from "@/lib/studentProgressWorkbook";
import { SCHEDULE_CACHE_TAG_STUDENT_PROGRESS } from "@/lib/scheduleCacheTags";

const WORKBOOK_PATH = path.join(process.cwd(), "public", "student-progress-beyond-math.xlsx");

const ALL_SHEET_NAMES = [
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6 By Topics",
  "F6 By Years",
  "F6 學校mock卷",
  "Cut Off",
  "Exam Schedule",
  M1_SHEET,
  M2_SHEET,
] as const;

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseSheetFromWorkbook(
  workbook: import("xlsx").WorkBook,
  sheetName: string,
  XLSX: typeof import("xlsx"),
): ProgressSheet | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const rawRows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  const cleanedRows = rawRows
    .map((row) => row.map((v) => cellToText(v)))
    .filter((row) => row.some((cell) => cell !== ""));
  if (!cleanedRows.length) return null;
  return {
    name: sheetName,
    headers: cleanedRows[0] ?? [],
    rows: cleanedRows.slice(1),
  };
}

const loadParsedSheetsCached = unstable_cache(
  async (): Promise<Record<string, ProgressSheet>> => {
    const buffer = await readFile(WORKBOOK_PATH);
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const out: Record<string, ProgressSheet> = {};
    for (const name of ALL_SHEET_NAMES) {
      const parsed = parseSheetFromWorkbook(workbook, name, XLSX);
      if (parsed) out[name] = parsed;
    }
    return out;
  },
  ["student-progress-workbook-parsed-v7"],
  { revalidate: 3600, tags: [SCHEDULE_CACHE_TAG_STUDENT_PROGRESS] },
);

const loadProgressPayloadForLevelCached = unstable_cache(
  async (level: number): Promise<StudentProgressWorkbookPayload> => {
    const sheetsRecord = await loadParsedSheetsCached();
    const sheetsByName = new Map(Object.entries(sheetsRecord));
    return buildProgressPayloadFromSheets(sheetsByName, level);
  },
  ["student-progress-sheets-v6"],
  { revalidate: 3600, tags: [SCHEDULE_CACHE_TAG_STUDENT_PROGRESS] },
);

export async function fetchStudentProgressForLevel(
  level: number,
  options?: ExtendedMathsOptions,
): Promise<StudentProgressWorkbookPayload> {
  const base = await loadProgressPayloadForLevelCached(level);
  if (!options?.takesM1 && !options?.takesM2) return base;

  const sheetsRecord = await loadParsedSheetsCached();
  const extra: ProgressSheet[] = [];
  if (options.takesM1 && sheetsRecord[M1_SHEET]) extra.push(sheetsRecord[M1_SHEET]);
  if (options.takesM2 && sheetsRecord[M2_SHEET]) extra.push(sheetsRecord[M2_SHEET]);
  if (!extra.length) return base;
  return { ...base, sheets: [...base.sheets, ...extra] };
}
