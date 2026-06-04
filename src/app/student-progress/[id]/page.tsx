"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import { supabase } from "@/lib/supabase";
import { loadExamInfo } from "@/lib/studentLessonStorage";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { normalizeStudentId } from "@/lib/studentId";
import { formatGradeDisplay } from "@/lib/grade";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";

type StudentSummary = {
  id: string;
  nameZh: string;
  nameEn: string;
  nicknameEn: string;
  grade: string;
  school: string;
  textbookPublisher: string;
};

type ProgressSheet = {
  name: string;
  headers: string[];
  rows: string[][];
};

type ProgressSelectionMap = Record<string, string>;

const PROGRESS_LEVEL_OPTIONS = ["Remedial", "Good", "Mastered"] as const;

const SELECTABLE_HEADERS = new Set([
  "basic concept",
  "chapter diagnosis",
  "exam type questions(mc)",
  "exam type questions(lq)",
  "road to dse(mc)",
  "road to dse(lq)",
  "a1",
  "a2",
  "b",
  "paper 2",
]);

type SheetColumn =
  | { kind: "normal"; header: string; colIndex: number }
  | { kind: "textbookCombined"; headerEn: string; headerZh: string; colIndexEn: number; colIndexZh: number };

function parseGradeLevel(grade: string): number | null {
  const m = grade.trim().match(/^F\.?\s*([1-6])$/i);
  if (!m) return null;
  const level = Number(m[1]);
  return Number.isFinite(level) ? level : null;
}

function getCumulativeSheetNames(level: number): string[] {
  const base: string[] = [];
  if (level >= 1) base.push("F1");
  if (level >= 2) base.push("F2");
  if (level >= 3) base.push("F3");
  if (level >= 4) base.push("F4");
  if (level >= 5) base.push("F5");
  if (level >= 6) base.push("F6 By Topics", "F6 By Years", "F6 學校mock卷", "Cut Off", "Exam Schedule");
  return base;
}

function getCurrentGradeSheetNames(level: number): string[] {
  if (level <= 1) return ["F1"];
  if (level === 2) return ["F2"];
  if (level === 3) return ["F3"];
  if (level === 4) return ["F4"];
  if (level === 5) return ["F5"];
  return ["F6 By Topics", "F6 By Years", "F6 學校mock卷"];
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeHeaderName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .trim();
}

function buildSheetColumns(headers: string[]): SheetColumn[] {
  const cols: SheetColumn[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const cur = headers[i] ?? "";
    const next = headers[i + 1] ?? "";
    const curNorm = normalizeHeaderName(cur);
    const nextNorm = normalizeHeaderName(next);
    if (curNorm === "textbook:" && nextNorm === "textbook:") {
      cols.push({
        kind: "textbookCombined",
        headerEn: cur || "Textbook:",
        headerZh: next || "課本：",
        colIndexEn: i,
        colIndexZh: i + 1,
      });
      i += 1;
      continue;
    }
    cols.push({ kind: "normal", header: cur, colIndex: i });
  }
  return cols;
}

function getSelectionStorageKey(studentId: string): string {
  return `student-progress-selection:${studentId}`;
}

function buildSelectionCellKey(sheetName: string, rowIndex: number, colIndex: number): string {
  return `${sheetName}::${rowIndex}::${colIndex}`;
}

function parseIntegerOrZero(value: string): number {
  const cleaned = value.replace(/[^\d]/g, "");
  if (!cleaned) return 0;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseNumberOrZero(value: string): number {
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return 0;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseYear(value: string): number | null {
  const m = value.trim().match(/^\d{4}$/);
  if (!m) return null;
  const y = Number.parseInt(m[0], 10);
  return Number.isFinite(y) ? y : null;
}

const GRADE_LABELS = ["-", "2", "3", "4", "5", "5*", "5**"] as const;
const DEFAULT_YEAR_GRADE_THRESHOLDS: Record<number, number[]> = {
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

function findNormalColumn(columns: SheetColumn[], headerNames: string[]): SheetColumn | undefined {
  const wanted = new Set(headerNames.map((name) => normalizeHeaderName(name)));
  return columns.find((c) => c.kind === "normal" && wanted.has(normalizeHeaderName(c.header || "")));
}

function computeRowPercent(
  sheetName: string,
  row: string[],
  rowIndex: number,
  columns: SheetColumn[],
  progressSelections: ProgressSelectionMap,
): number {
  const paper1Col = findNormalColumn(columns, ["paper 1"]);
  const paper2Col = findNormalColumn(columns, ["paper 2"]);
  const marksAfterPaper2Col = columns.find(
    (c) =>
      c.kind === "normal" &&
      c.colIndex > (paper2Col?.kind === "normal" ? paper2Col.colIndex : -1) &&
      normalizeHeaderName(c.header || "") === "marks",
  );

  const paper1MarksCols =
    paper1Col && paper1Col.kind === "normal"
      ? columns.filter(
          (c) =>
            c.kind === "normal" &&
            c.colIndex < paper1Col.colIndex &&
            normalizeHeaderName(c.header || "") === "marks",
        )
      : [];
  const paper1Total =
    paper1Col && paper1Col.kind === "normal"
      ? paper1MarksCols.length > 0
        ? paper1MarksCols.reduce((sum, c) => {
            if (c.kind !== "normal") return sum;
            const leftKey = buildSelectionCellKey(sheetName, rowIndex, c.colIndex);
            const leftRaw = progressSelections[leftKey] ?? row[c.colIndex] ?? "";
            return sum + parseIntegerOrZero(String(leftRaw));
          }, 0)
        : parseIntegerOrZero(
            String(
              progressSelections[buildSelectionCellKey(sheetName, rowIndex, paper1Col.colIndex)] ??
                row[paper1Col.colIndex] ??
                "",
            ),
          )
      : 0;

  const paper2MarksColIndex =
    marksAfterPaper2Col && marksAfterPaper2Col.kind === "normal" ? marksAfterPaper2Col.colIndex : -1;
  const paper2Key =
    paper2MarksColIndex >= 0 ? buildSelectionCellKey(sheetName, rowIndex, paper2MarksColIndex) : "";
  const paper2Raw =
    paper2MarksColIndex >= 0 ? progressSelections[paper2Key] ?? row[paper2MarksColIndex] ?? "" : "";
  const paper2Marks = parseNumberOrZero(String(paper2Raw));

  return (paper1Total / 105) * 65 + (paper2Marks / 45) * 35;
}

function lookupGradeByThresholds(
  year: number | null,
  percent: number,
  yearGradeThresholds: Record<number, number[]>,
): string {
  if (!year) return "-";
  const thresholds = yearGradeThresholds[year];
  if (!thresholds) return "-";
  let idx = 0;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (percent >= thresholds[i]) idx = i;
  }
  return GRADE_LABELS[idx] ?? "-";
}

function parsePercentFromCutoffCell(value: string): number | null {
  const m = value.match(/\((\d+(?:\.\d+)?)\)/);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function loadCutOffOverride(): ProgressSheet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CUT_OFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const headers = Array.isArray((parsed as ProgressSheet).headers)
      ? (parsed as ProgressSheet).headers.map((h) => String(h ?? ""))
      : null;
    const rows = Array.isArray((parsed as ProgressSheet).rows)
      ? (parsed as ProgressSheet).rows.map((row) =>
          Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [],
        )
      : null;
    if (!headers?.length || !rows) return null;
    return { name: CUT_OFF_SHEET, headers, rows };
  } catch {
    return null;
  }
}

function saveCutOffOverride(sheet: ProgressSheet) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUT_OFF_STORAGE_KEY, JSON.stringify(sheet));
}

function trimCutOffSheet(sheet: ProgressSheet): ProgressSheet {
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

type CutOffDisplayModel = {
  levelHeaders: string[];
  yearRows: string[][];
};

function buildCutOffDisplayModel(sheet: ProgressSheet): CutOffDisplayModel {
  const levelHeaders = [sheet.headers[0] || "Level 等級", ...sheet.rows.map((row) => String(row[0] ?? "").trim())];
  const yearRows: string[][] = [];
  for (let yearCol = 1; yearCol < sheet.headers.length; yearCol += 1) {
    yearRows.push([sheet.headers[yearCol] ?? "", ...sheet.rows.map((row) => row[yearCol] ?? "")]);
  }
  return { levelHeaders, yearRows };
}

function applyCutOffDisplayCellUpdate(
  sheet: ProgressSheet,
  displayRowIndex: number,
  displayColIndex: number,
  value: string,
): ProgressSheet {
  const yearCol = displayRowIndex + 1;
  if (displayColIndex === 0) {
    const headers = sheet.headers.map((cell, index) => (index === yearCol ? value : cell));
    return { ...sheet, headers };
  }
  const levelRowIndex = displayColIndex - 1;
  const rows = sheet.rows.map((row, rowIndex) => {
    if (rowIndex !== levelRowIndex) return row;
    const next = [...row];
    while (next.length <= yearCol) next.push("");
    next[yearCol] = value;
    return next;
  });
  return { ...sheet, rows };
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

function syncF6ByYearsWithCutOff(f6Sheet: ProgressSheet, cutOffSheet: ProgressSheet): ProgressSheet {
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

function parseCutOffThresholds(rows: string[][]): Record<number, number[]> {
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

function normalizeDateForInput(value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const dd = slashMatch[1].padStart(2, "0");
    const mm = slashMatch[2].padStart(2, "0");
    const yyyy = slashMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return "";
}

function getProgressLevelKey(value: string): "remedial" | "good" | "mastered" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "remedial") return "remedial";
  if (normalized === "good") return "good";
  if (normalized === "mastered") return "mastered";
  return null;
}

function getProgressLevelSelectClass(value: string): string {
  const key = getProgressLevelKey(value);
  if (key === "remedial") {
    return "border-rose-300 bg-rose-50 text-rose-800";
  }
  if (key === "good") {
    return "border-amber-300 bg-amber-50 text-amber-800";
  }
  if (key === "mastered") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  return "border-slate-300 bg-white text-slate-800";
}

function getProgressLevelRowClass(levelValue: string): string {
  const key = getProgressLevelKey(levelValue);
  if (key === "remedial") return "bg-rose-50/70";
  if (key === "good") return "bg-amber-50/70";
  if (key === "mastered") return "bg-emerald-50/70";
  return "";
}

function getProgressLevelStickyBgClass(levelValue: string): string {
  const key = getProgressLevelKey(levelValue);
  if (key === "remedial") return "bg-rose-50/70";
  if (key === "good") return "bg-amber-50/70";
  if (key === "mastered") return "bg-emerald-50/70";
  return "bg-white";
}

function getProgressLevelCellClass(levelValue: string): string {
  const key = getProgressLevelKey(levelValue);
  if (key === "remedial") return "font-semibold text-rose-800";
  if (key === "good") return "font-semibold text-amber-800";
  if (key === "mastered") return "font-semibold text-emerald-800";
  return "text-slate-700";
}

const LEGEND_ORDER = ["remedial", "good", "mastered"] as const;

type LegendEntry = {
  label: string;
  description: string;
  key: (typeof LEGEND_ORDER)[number];
};

function extractLegendEntries(rows: string[][]): LegendEntry[] {
  const entries: LegendEntry[] = [];
  for (const row of rows) {
    const key = getProgressLevelKey(row[0] || "");
    if (!key) continue;
    entries.push({
      label: (row[0] || "").trim(),
      description: (row[1] || "").trim(),
      key,
    });
  }
  return entries.sort((a, b) => LEGEND_ORDER.indexOf(a.key) - LEGEND_ORDER.indexOf(b.key));
}

function isLegendDataRow(row: string[]): boolean {
  return getProgressLevelKey(row[0] || "") !== null;
}

function getPercentInputClass(): string {
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function getPercentFeedbackClass(_percent?: number): string {
  return getPercentInputClass();
}

const CUT_OFF_SHEET = "Cut Off";
const CUT_OFF_STORAGE_KEY = "beyondmath-student-progress-cutoff";
const CUT_OFF_FIXED_LEVELS = ["5**", "5*", "5", "4", "3", "2"] as const;
const CUT_OFF_YEAR_CELL_PAD = "px-2 py-2";
const CUT_OFF_YEAR_INPUT_CLASS =
  "min-w-[114px] max-w-[114px] rounded-md border border-slate-300 bg-white px-[0.45rem] py-1 text-sm text-slate-800";
const CUT_OFF_YEAR_HEADER_INPUT_CLASS =
  "min-w-[114px] max-w-[114px] rounded-md border border-slate-300 bg-white px-[0.45rem] py-1 text-sm font-semibold text-slate-800";
const CUT_OFF_TABLE_BODY_SCROLL_CLASS =
  "min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable_both-edges] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400";

const F6_BY_YEARS_SHEET = "F6 By Years";
const F6_YEARS_FROZEN_COL0_CLASS = "min-w-[4.5rem] max-w-[4.5rem]";

function isF6ByYearsSheet(sheetName: string): boolean {
  return sheetName === F6_BY_YEARS_SHEET;
}

function isF6ByYearsFrozenCol0(sheetName: string, colIndex: number): boolean {
  return isF6ByYearsSheet(sheetName) && colIndex === 0;
}

function isF6ByYearsFrozenDse(sheetName: string, headerName: string): boolean {
  return isF6ByYearsSheet(sheetName) && headerName === "dse";
}

export default function StudentProgressByIdPage() {
  const params = useParams<{ id: string }>();
  const studentId = normalizeStudentId(String(params?.id || ""));
  const [studentSummary, setStudentSummary] = useState<StudentSummary>({
    id: studentId,
    nameZh: "",
    nameEn: "",
    nicknameEn: "",
    grade: "",
    school: "",
    textbookPublisher: "",
  });
  const [examInfo, setExamInfo] = useState<{ examDate: string; examContent: string }>({
    examDate: "",
    examContent: "",
  });
  const [studentLoaded, setStudentLoaded] = useState(false);
  const [studentNotFound, setStudentNotFound] = useState(false);
  const [progressSheets, setProgressSheets] = useState<ProgressSheet[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState("");
  const [progressSelections, setProgressSelections] = useState<ProgressSelectionMap>({});
  const [yearGradeThresholds, setYearGradeThresholds] = useState<Record<number, number[]>>(DEFAULT_YEAR_GRADE_THRESHOLDS);
  const [cutOffSheet, setCutOffSheet] = useState<ProgressSheet | null>(null);
  const [activeSheetName, setActiveSheetName] = useState("");
  const gradeLevel = parseGradeLevel(studentSummary.grade);
  const currentGradeSheetNames = new Set(gradeLevel ? getCurrentGradeSheetNames(gradeLevel) : []);
  const activeProgressSheet =
    progressSheets.find((sheet) => sheet.name === activeSheetName) ?? progressSheets[0] ?? null;
  const activeDisplaySheet =
    activeProgressSheet?.name === CUT_OFF_SHEET && cutOffSheet ? cutOffSheet : activeProgressSheet;
  const activeLegendEntries = activeDisplaySheet ? extractLegendEntries(activeDisplaySheet.rows) : [];

  const commitCutOffSheet = (next: ProgressSheet) => {
    const trimmed = trimCutOffSheet(next);
    setCutOffSheet(trimmed);
    setProgressSheets((prev) =>
      prev.map((sheet) => {
        if (sheet.name === CUT_OFF_SHEET) return trimmed;
        if (sheet.name === F6_BY_YEARS_SHEET) return syncF6ByYearsWithCutOff(sheet, trimmed);
        return sheet;
      }),
    );
    saveCutOffOverride(trimmed);
    const thresholds = parseCutOffThresholds([trimmed.headers, ...trimmed.rows]);
    setYearGradeThresholds({ ...DEFAULT_YEAR_GRADE_THRESHOLDS, ...thresholds });
  };

  const updateCutOffDisplayCell = (displayRowIndex: number, displayColIndex: number, value: string) => {
    if (!cutOffSheet) return;
    commitCutOffSheet(applyCutOffDisplayCellUpdate(cutOffSheet, displayRowIndex, displayColIndex, value));
  };

  const addCutOffRow = () => {
    if (!cutOffSheet) return;
    const newYear = `${new Date().getFullYear()}/0(%)`;
    const headers = [cutOffSheet.headers[0] ?? "Level 等級", newYear, ...cutOffSheet.headers.slice(1)];
    const rows = cutOffSheet.rows.map((row) => [row[0] ?? "", "", ...row.slice(1)]);
    commitCutOffSheet({ ...cutOffSheet, headers, rows });
  };

  useEffect(() => {
    if (!progressSheets.length) {
      setActiveSheetName("");
      return;
    }
    if (activeSheetName && progressSheets.some((sheet) => sheet.name === activeSheetName)) return;
    if (gradeLevel) {
      const preferred = getCurrentGradeSheetNames(gradeLevel);
      const match = preferred.find((name) => progressSheets.some((sheet) => sheet.name === name));
      if (match) {
        setActiveSheetName(match);
        return;
      }
    }
    setActiveSheetName(progressSheets[0].name);
  }, [progressSheets, gradeLevel, activeSheetName]);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    setStudentLoaded(false);
    setStudentNotFound(false);

    void (async () => {
      const [studentRes, exam] = await Promise.all([
        supabase
          .from("students")
          .select("id, name_zh, name_en, nickname_en, grade, school, textbook_publisher")
          .eq("id", studentId)
          .maybeSingle(),
        loadExamInfo(studentId),
      ]);

      if (cancelled) return;
      setExamInfo(exam);

      const data = studentRes.data;
      if (!data) {
        setStudentSummary({
          id: studentId,
          nameZh: "",
          nameEn: "",
          nicknameEn: "",
          grade: "",
          school: "",
          textbookPublisher: "",
        });
        setStudentNotFound(true);
        setStudentLoaded(true);
        return;
      }

      setStudentSummary({
        id: data.id,
        nameZh: data.name_zh ?? "",
        nameEn: data.name_en ?? "",
        nicknameEn: data.nickname_en ?? "",
        grade: data.grade ?? "",
        school: data.school ?? "",
        textbookPublisher: data.textbook_publisher ?? "",
      });
      setStudentNotFound(false);
      setStudentLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [studentId]);

  useEffect(() => {
    if (!studentId) {
      setProgressSelections({});
      return;
    }
    try {
      const raw = window.localStorage.getItem(getSelectionStorageKey(studentId));
      if (!raw) {
        setProgressSelections({});
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        setProgressSelections(parsed as ProgressSelectionMap);
      } else {
        setProgressSelections({});
      }
    } catch {
      setProgressSelections({});
    }
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    window.localStorage.setItem(getSelectionStorageKey(studentId), JSON.stringify(progressSelections));
  }, [studentId, progressSelections]);

  useEffect(() => {
    const level = gradeLevel;
    if (!level) {
      setProgressSheets([]);
      setCutOffSheet(null);
      setProgressError("");
      setProgressLoading(false);
      return;
    }

    let cancelled = false;
    setProgressLoading(true);
    setProgressError("");

    void (async () => {
      try {
        const response = await fetch("/student-progress-beyond-math.xlsx", { cache: "no-store" });
        if (!response.ok) throw new Error("Workbook not found");
        const buffer = await response.arrayBuffer();
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "array" });
        const wantedSheets = getCumulativeSheetNames(level);
        const parsed: ProgressSheet[] = [];

        const savedCutOff = loadCutOffOverride();
        const cutOffWorkbookSheet = workbook.Sheets[CUT_OFF_SHEET];
        let loadedCutOffSheet: ProgressSheet | null = savedCutOff;
        if (!loadedCutOffSheet && cutOffWorkbookSheet) {
          const cutOffRows = XLSX.utils
            .sheet_to_json<(string | number | boolean | null)[]>(cutOffWorkbookSheet, {
              header: 1,
              defval: "",
              blankrows: false,
            })
            .map((row) => row.map((v) => cellToText(v)))
            .filter((row) => row.some((cell) => cell !== ""));
          if (cutOffRows.length) {
            loadedCutOffSheet = trimCutOffSheet({
              name: CUT_OFF_SHEET,
              headers: cutOffRows[0] ?? [],
              rows: cutOffRows.slice(1),
            });
          }
        }
        if (loadedCutOffSheet) {
          setCutOffSheet(loadedCutOffSheet);
          const parsedThresholds = parseCutOffThresholds([
            loadedCutOffSheet.headers,
            ...loadedCutOffSheet.rows,
          ]);
          setYearGradeThresholds({ ...DEFAULT_YEAR_GRADE_THRESHOLDS, ...parsedThresholds });
        } else {
          setCutOffSheet(null);
          setYearGradeThresholds(DEFAULT_YEAR_GRADE_THRESHOLDS);
        }

        for (const sheetName of wantedSheets) {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) continue;
          const rawRows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
            header: 1,
            defval: "",
            blankrows: false,
          });
          const cleanedRows = rawRows
            .map((row) => row.map((v) => cellToText(v)))
            .filter((row) => row.some((cell) => cell !== ""));
          if (!cleanedRows.length) continue;

          const headers = cleanedRows[0];
          let rows = cleanedRows.slice(1);
          if (sheetName === CUT_OFF_SHEET && loadedCutOffSheet) {
            parsed.push(loadedCutOffSheet);
            continue;
          }
          if (sheetName === F6_BY_YEARS_SHEET && loadedCutOffSheet) {
            rows = syncF6ByYearsWithCutOff({ name: sheetName, headers, rows }, loadedCutOffSheet).rows;
          }
          parsed.push({ name: sheetName, headers, rows });
        }

        if (!cancelled) setProgressSheets(parsed);
      } catch {
        if (!cancelled) {
          setProgressSheets([]);
          setCutOffSheet(null);
          setProgressError("無法讀取 Student Progress Excel。");
          setYearGradeThresholds(DEFAULT_YEAR_GRADE_THRESHOLDS);
        }
      } finally {
        if (!cancelled) setProgressLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gradeLevel]);

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="students" />

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div
            className="sticky top-[52px] z-50 rounded-t-2xl px-6 py-5 text-white shadow-[0_4px_12px_rgba(15,23,42,0.12)] sm:top-[56px]"
            style={{ backgroundImage: PRIMARY_GRADIENT }}
          >
            <div className="flex items-center gap-3">
              <Link
                href={`/students/${encodeURIComponent(studentId)}/lessons`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xl font-bold leading-none hover:bg-white/30"
                aria-label="Back to student lesson record"
              >
                ←
              </Link>
              <h1 className="text-2xl font-bold tracking-tight">Student Lesson Record</h1>
            </div>
            <p className="mt-1 text-sm text-blue-100">
              Student ID: {studentId || "—"} | Student:{" "}
              {formatStudentDisplayNameOrEmpty(
                {
                  id: studentSummary.id,
                  name_zh: studentSummary.nameZh,
                  name_en: studentSummary.nameEn,
                  nickname_en: studentSummary.nicknameEn,
                },
                "full",
                "—",
              )}
            </p>
          </div>

          {studentLoaded && studentNotFound && (
            <div className="mx-6 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Student record {studentId} was not found.
            </div>
          )}

          <div className="border-b border-slate-200 bg-slate-50 p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">Student ID</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentId || "—"}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs font-semibold tracking-wider text-slate-500">Student Name</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {formatStudentDisplayNameOrEmpty(
                      {
                        id: studentSummary.id,
                        name_zh: studentSummary.nameZh,
                        name_en: studentSummary.nameEn,
                        nickname_en: studentSummary.nicknameEn,
                      },
                      "full",
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">Grade</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{formatGradeDisplay(studentSummary.grade) || "—"}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs font-semibold tracking-wider text-slate-500">School</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.school || "—"}</p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <p className="text-xs font-semibold tracking-wider text-slate-500">Latest Exam Date</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{examInfo.examDate || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wider text-slate-500">Exam Content</p>
                    <p className="mt-1 break-words text-sm font-bold text-slate-900">{examInfo.examContent || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wider text-slate-500">Textbook publisher</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.textbookPublisher || "—"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <h2 className="text-lg font-bold text-slate-900">Student Progress Content</h2>

            {progressLoading ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                正在載入工作簿…
              </div>
            ) : null}

            {progressError ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {progressError}
              </div>
            ) : null}

            {!progressLoading && !progressError && !progressSheets.length ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                當前學生年級未能匹配到可顯示的進度內容。
              </div>
            ) : null}

            {activeProgressSheet ? (
              <div className="mt-4 flex flex-col rounded-xl border border-slate-200 bg-white">
                <div
                  className={`max-h-[70vh] min-h-0 rounded-t-xl ${
                    activeProgressSheet.name === CUT_OFF_SHEET
                      ? "flex flex-col overflow-hidden"
                      : "overflow-auto [scrollbar-gutter:stable_both-edges] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400"
                  }`}
                >
                  {(() => {
                    const sheet = activeProgressSheet;
                    const isCutOffSheet = sheet.name === CUT_OFF_SHEET;
                    const activeSheet = isCutOffSheet && cutOffSheet ? cutOffSheet : sheet;
                    const columns = buildSheetColumns(activeSheet.headers);
                    const cutOffDisplay = isCutOffSheet ? buildCutOffDisplayModel(activeSheet) : null;
                    return (
                      <>
                        {isCutOffSheet && cutOffDisplay ? (
                          <div className="flex min-h-0 flex-1 flex-col">
                            <div className={CUT_OFF_TABLE_BODY_SCROLL_CLASS}>
                              <table className="min-w-full border-separate border-spacing-0 text-sm">
                                <thead>
                                  <tr>
                                    {cutOffDisplay.levelHeaders.map((label, colIndex) => (
                                      <th
                                        key={`${sheet.name}-cutoff-head-${colIndex}`}
                                        className={`sticky top-0 whitespace-nowrap bg-slate-100 text-left font-semibold text-slate-700 shadow-[inset_0_-1px_0_0_rgba(226,232,240,1)] ${
                                          colIndex === 0
                                            ? `sticky left-0 top-0 z-40 ${CUT_OFF_YEAR_CELL_PAD} shadow-[inset_-1px_0_0_rgba(226,232,240,1),inset_0_-1px_0_0_rgba(226,232,240,1)]`
                                            : `sticky top-0 z-30 ${colIndex === 1 ? CUT_OFF_YEAR_CELL_PAD : "px-3 py-2"}`
                                        }`}
                                      >
                                        <span>{label || " "}</span>
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {cutOffDisplay.yearRows.map((displayRow, displayRowIndex) => (
                                    <tr
                                      key={`${sheet.name}-cutoff-year-${displayRowIndex}`}
                                      className="border-t border-slate-100"
                                    >
                                      {displayRow.map((cell, displayColIndex) => (
                                        <td
                                          key={`${sheet.name}-cutoff-year-${displayRowIndex}-col-${displayColIndex}`}
                                          className={
                                            displayColIndex === 0
                                              ? `sticky left-0 z-20 bg-white ${CUT_OFF_YEAR_CELL_PAD} shadow-[inset_-1px_0_0_rgba(241,245,249,1)]`
                                              : CUT_OFF_YEAR_CELL_PAD
                                          }
                                        >
                                          <input
                                            type="text"
                                            value={cell}
                                            onChange={(e) =>
                                              updateCutOffDisplayCell(displayRowIndex, displayColIndex, e.target.value)
                                            }
                                            className={
                                              displayColIndex === 0
                                                ? CUT_OFF_YEAR_HEADER_INPUT_CLASS
                                                : CUT_OFF_YEAR_INPUT_CLASS
                                            }
                                          />
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
                              <button
                                type="button"
                                onClick={addCutOffRow}
                                className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                              >
                                + Add Row
                              </button>
                            </div>
                          </div>
                        ) : (
                        <table className="min-w-full text-sm">
                      <thead className="sticky top-0 z-20 bg-slate-100">
                        <tr>
                          {columns.map((col) => {
                            if (col.kind === "textbookCombined") {
                              return (
                                <th
                                  key={`${sheet.name}-head-textbook-${col.colIndexEn}`}
                                  className="sticky left-0 z-30 min-w-[270px] whitespace-nowrap bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 shadow-[inset_-1px_0_0_rgba(226,232,240,1),inset_0_-1px_0_0_rgba(226,232,240,1)]"
                                >
                                  <span className="block leading-5">Textbook</span>
                                </th>
                              );
                            }
                            const headerNameHead = normalizeHeaderName(col.header || "");
                            const frozenCol0Head = isF6ByYearsFrozenCol0(sheet.name, col.colIndex);
                            const frozenDseHead = isF6ByYearsFrozenDse(sheet.name, headerNameHead);
                            return (
                              <th
                                key={`${sheet.name}-head-${col.colIndex}`}
                                className={`whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700 shadow-[inset_0_-1px_0_0_rgba(226,232,240,1)] ${
                                  frozenCol0Head
                                    ? `sticky left-0 z-30 ${F6_YEARS_FROZEN_COL0_CLASS} bg-slate-100 shadow-[inset_-1px_0_0_rgba(226,232,240,1),inset_0_-1px_0_0_rgba(226,232,240,1)]`
                                    : frozenDseHead
                                      ? "sticky left-[4.5rem] z-30 min-w-[5.5rem] bg-slate-100 shadow-[inset_-1px_0_0_rgba(226,232,240,1),inset_0_-1px_0_0_rgba(226,232,240,1)]"
                                      : ""
                                }`}
                              >
                                {(() => {
                                  if (headerNameHead === "marks") {
                                    return "Marks";
                                  }
                                  return col.header || " ";
                                })()}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {activeSheet.rows.map((row, rowIndex) => {
                          if (isLegendDataRow(row)) return null;
                          const rowLevelValue = row[0] || "";
                          return (
                            <tr
                              key={`${sheet.name}-row-${rowIndex}`}
                              className={`border-t border-slate-100 ${getProgressLevelRowClass(rowLevelValue)}`}
                            >
                              {columns.map((col) => {
                                  if (col.kind === "textbookCombined") {
                                    const en = row[col.colIndexEn] || "";
                                    const zh = row[col.colIndexZh] || "";
                                    return (
                                      <td
                                        key={`${sheet.name}-row-${rowIndex}-textbook-${col.colIndexEn}`}
                                        className={`sticky left-0 z-10 min-w-[270px] whitespace-normal px-3 py-2 shadow-[inset_-1px_0_0_rgba(241,245,249,1)] ${getProgressLevelStickyBgClass(
                                          rowLevelValue,
                                        )} ${getProgressLevelCellClass(rowLevelValue)}`}
                                      >
                                        <span className="block leading-5">{en || " "}</span>
                                        <span className="block leading-5 text-slate-600">{zh || " "}</span>
                                      </td>
                                    );
                                  }

                                  const headerName = normalizeHeaderName(col.header || "");
                                  const isRemarks = headerName === "remarks";
                                  const colIndex = col.colIndex;
                                  const frozenCol0 = isF6ByYearsFrozenCol0(sheet.name, colIndex);
                                  const frozenDse = isF6ByYearsFrozenDse(sheet.name, headerName);
                                  return (
                                    <td
                                      key={`${sheet.name}-row-${rowIndex}-col-${colIndex}`}
                                      className={`${isRemarks ? "whitespace-normal" : "whitespace-nowrap"} px-3 py-2 ${getProgressLevelCellClass(
                                        rowLevelValue,
                                      )} ${
                                        frozenCol0
                                          ? `sticky left-0 z-10 ${F6_YEARS_FROZEN_COL0_CLASS} shadow-[inset_-1px_0_0_rgba(241,245,249,1)] ${getProgressLevelStickyBgClass(
                                              rowLevelValue,
                                            )}`
                                          : frozenDse
                                            ? `sticky left-[4.5rem] z-10 min-w-[5.5rem] shadow-[inset_-1px_0_0_rgba(241,245,249,1)] ${getProgressLevelStickyBgClass(
                                                rowLevelValue,
                                              )}`
                                            : ""
                                      }`}
                                    >
                                      {(() => {
                                        const selectionKey = buildSelectionCellKey(sheet.name, rowIndex, colIndex);
                                        if (headerName === "%") {
                                          const percentage = computeRowPercent(
                                            sheet.name,
                                            row,
                                            rowIndex,
                                            columns,
                                            progressSelections,
                                          );
                                          const display = Number.isFinite(percentage) ? percentage.toFixed(1) : "0.0";
                                          return (
                                            <input
                                              type="text"
                                              value={display}
                                              readOnly
                                              className={`w-[120px] min-w-[90px] rounded-md border px-2 py-1 text-sm font-semibold ${getPercentInputClass()}`}
                                            />
                                          );
                                        }
                                        if (headerName.startsWith("grade")) {
                                          const yearCol = findNormalColumn(columns, ["year", "dse"]);
                                          const yearRaw =
                                            yearCol && yearCol.kind === "normal" ? String(row[yearCol.colIndex] ?? "") : "";
                                          const year = parseYear(yearRaw);
                                          const percent = computeRowPercent(
                                            sheet.name,
                                            row,
                                            rowIndex,
                                            columns,
                                            progressSelections,
                                          );
                                          const grade = lookupGradeByThresholds(year, percent, yearGradeThresholds);
                                          return (
                                            <input
                                              type="text"
                                              value={grade}
                                              readOnly
                                              className="w-[120px] min-w-[90px] rounded-md border border-slate-300 bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700"
                                            />
                                          );
                                        }
                                        if (headerName === "paper 1") {
                                          const paper1MarksCols = columns.filter(
                                            (c) =>
                                              c.kind === "normal" &&
                                              c.colIndex < colIndex &&
                                              normalizeHeaderName(c.header || "") === "marks",
                                          );
                                          if (paper1MarksCols.length > 0) {
                                            const total = paper1MarksCols.reduce((sum, c) => {
                                              if (c.kind !== "normal") return sum;
                                              const leftKey = buildSelectionCellKey(sheet.name, rowIndex, c.colIndex);
                                              const leftRaw = progressSelections[leftKey] ?? row[c.colIndex] ?? "";
                                              return sum + parseIntegerOrZero(String(leftRaw));
                                            }, 0);
                                            return (
                                              <input
                                                type="number"
                                                value={String(total)}
                                                readOnly
                                                className="w-[120px] min-w-[90px] rounded-md border border-slate-300 bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700"
                                              />
                                            );
                                          }
                                          const stored = progressSelections[selectionKey];
                                          const rawValue = stored ?? row[colIndex] ?? "";
                                          const value = typeof rawValue === "string" ? rawValue.trim() : String(rawValue ?? "").trim();
                                          return (
                                            <input
                                              type="number"
                                              inputMode="numeric"
                                              step={1}
                                              min={0}
                                              value={value}
                                              onChange={(e) => {
                                                const nextRaw = e.target.value;
                                                const cleaned = nextRaw.replace(/[^\d]/g, "");
                                                setProgressSelections((prev) => {
                                                  if (!cleaned) {
                                                    const { [selectionKey]: _, ...rest } = prev;
                                                    return rest;
                                                  }
                                                  return { ...prev, [selectionKey]: cleaned };
                                                });
                                              }}
                                              className="w-[120px] min-w-[90px] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                                            />
                                          );
                                        }
                                        if (headerName === "marks") {
                                          const stored = progressSelections[selectionKey];
                                          const rawValue = stored ?? row[colIndex] ?? "";
                                          const value = typeof rawValue === "string" ? rawValue.trim() : String(rawValue ?? "").trim();
                                          return (
                                            <input
                                              type="number"
                                              inputMode="numeric"
                                              step={1}
                                              min={0}
                                              value={value}
                                              onChange={(e) => {
                                                const nextRaw = e.target.value;
                                                const cleaned = nextRaw.replace(/[^\d]/g, "");
                                                setProgressSelections((prev) => {
                                                  if (!cleaned) {
                                                    const { [selectionKey]: _, ...rest } = prev;
                                                    return rest;
                                                  }
                                                  return { ...prev, [selectionKey]: cleaned };
                                                });
                                              }}
                                              className="w-[120px] min-w-[90px] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                                            />
                                          );
                                        }
                                        if (headerName === "date") {
                                          const dateValue = normalizeDateForInput(
                                            progressSelections[selectionKey] ?? row[colIndex] ?? "",
                                          );
                                          return (
                                            <input
                                              type="date"
                                              value={dateValue}
                                              onChange={(e) => {
                                                const nextValue = e.target.value;
                                                setProgressSelections((prev) => {
                                                  if (!nextValue) {
                                                    const { [selectionKey]: _, ...rest } = prev;
                                                    return rest;
                                                  }
                                                  return { ...prev, [selectionKey]: nextValue };
                                                });
                                              }}
                                              className="min-w-[145px] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                                            />
                                          );
                                        }
                                        if (headerName === "remarks") {
                                          const value = progressSelections[selectionKey] ?? row[colIndex] ?? "";
                                          return (
                                            <textarea
                                              value={value}
                                              onChange={(e) => {
                                                const nextValue = e.target.value;
                                                setProgressSelections((prev) => {
                                                  if (!nextValue.trim()) {
                                                    const { [selectionKey]: _, ...rest } = prev;
                                                    return rest;
                                                  }
                                                  return { ...prev, [selectionKey]: nextValue };
                                                });
                                              }}
                                              rows={2}
                                              className="min-h-[2rem] w-[200px] min-w-[160px] resize-y rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                                            />
                                          );
                                        }
                                        if (!SELECTABLE_HEADERS.has(headerName)) return row[colIndex] || " ";
                                        const selected = progressSelections[selectionKey] ?? "";
                                        return (
                                          <select
                                            value={selected}
                                            onChange={(e) => {
                                              const nextValue = e.target.value;
                                              setProgressSelections((prev) => {
                                                if (!nextValue) {
                                                  const { [selectionKey]: _, ...rest } = prev;
                                                  return rest;
                                                }
                                                return { ...prev, [selectionKey]: nextValue };
                                              });
                                            }}
                                            className={`min-w-[120px] rounded-md border px-2 py-1 text-sm font-semibold ${getProgressLevelSelectClass(selected)}`}
                                          >
                                            <option value="">—</option>
                                            {PROGRESS_LEVEL_OPTIONS.map((option) => (
                                              <option key={option} value={option}>
                                                {option}
                                              </option>
                                            ))}
                                          </select>
                                        );
                                      })()}
                                    </td>
                                  );
                                })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                        )}
                    </>
                    );
                  })()}
                </div>

                {activeLegendEntries.length > 0 ? (
                  <div className="shrink-0 overflow-x-auto border-t border-slate-200 bg-slate-50 px-4 py-2.5">
                    <div className="whitespace-nowrap text-sm">
                      {activeLegendEntries.map((entry, entryIndex) => (
                        <span key={entry.key} className={getProgressLevelCellClass(entry.label)}>
                          {entryIndex > 0 ? <span className="mx-5 font-normal text-slate-300">|</span> : null}
                          <span className="font-bold">{entry.label}</span>
                          {entry.description ? (
                            <span className="ml-2 font-normal text-slate-700">{entry.description}</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="sticky bottom-0 z-40 flex shrink-0 overflow-x-auto rounded-b-xl border-t border-slate-300 bg-[#eef2f6] shadow-[0_-4px_12px_rgba(15,23,42,0.08)]">
                  {progressSheets.map((tabSheet) => {
                    const isActive = tabSheet.name === activeSheetName;
                    const isCurrentGrade = currentGradeSheetNames.has(tabSheet.name);
                    return (
                      <button
                        key={tabSheet.name}
                        type="button"
                        onClick={() => setActiveSheetName(tabSheet.name)}
                        className={`shrink-0 border-r border-slate-300 px-4 py-2 text-sm font-semibold transition ${
                          isActive
                            ? "bg-emerald-600 text-white"
                            : isCurrentGrade
                              ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                              : "bg-[#eef2f6] text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        {tabSheet.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
