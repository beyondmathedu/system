import { readFile } from "node:fs/promises";
import path from "node:path";
import { unstable_cache } from "next/cache";
import {
  buildProgressPayloadFromSheets,
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
  ["student-progress-workbook-parsed-v3"],
  { revalidate: 3600, tags: [SCHEDULE_CACHE_TAG_STUDENT_PROGRESS] },
);

const loadProgressPayloadForLevelCached = unstable_cache(
  async (level: number): Promise<StudentProgressWorkbookPayload> => {
    const sheetsRecord = await loadParsedSheetsCached();
    const sheetsByName = new Map(Object.entries(sheetsRecord));
    return buildProgressPayloadFromSheets(sheetsByName, level);
  },
  ["student-progress-sheets-v1"],
  { revalidate: 3600, tags: [SCHEDULE_CACHE_TAG_STUDENT_PROGRESS] },
);

export async function fetchStudentProgressForLevel(level: number): Promise<StudentProgressWorkbookPayload> {
  return loadProgressPayloadForLevelCached(level);
}
