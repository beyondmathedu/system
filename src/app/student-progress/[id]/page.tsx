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
  const thresholds = yearGradeThresholds[year] ?? DEFAULT_YEAR_GRADE_THRESHOLDS[year];
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

function getPercentFeedbackClass(percent: number): string {
  if (percent >= 74) return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (percent >= 50) return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-rose-300 bg-rose-50 text-rose-800";
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
  const gradeLevel = parseGradeLevel(studentSummary.grade);
  const currentGradeSheetNames = new Set(gradeLevel ? getCurrentGradeSheetNames(gradeLevel) : []);

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

        const cutOffSheet = workbook.Sheets["Cut Off"];
        if (cutOffSheet) {
          const cutOffRows = XLSX.utils
            .sheet_to_json<(string | number | boolean | null)[]>(cutOffSheet, {
              header: 1,
              defval: "",
              blankrows: false,
            })
            .map((row) => row.map((v) => cellToText(v)));
          const parsedThresholds = parseCutOffThresholds(cutOffRows);
          if (Object.keys(parsedThresholds).length) {
            setYearGradeThresholds(parsedThresholds);
          } else {
            setYearGradeThresholds(DEFAULT_YEAR_GRADE_THRESHOLDS);
          }
        } else {
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
          const rows = cleanedRows.slice(1);
          parsed.push({ name: sheetName, headers, rows });
        }

        if (!cancelled) setProgressSheets(parsed);
      } catch {
        if (!cancelled) {
          setProgressSheets([]);
          setProgressError("无法读取 Student Progress Excel。");
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

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
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
                Loading workbook...
              </div>
            ) : null}

            {progressError ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {progressError}
              </div>
            ) : null}

            {!progressLoading && !progressError && !progressSheets.length ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                当前学生年级未能匹配到可显示的进度内容。
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              {progressSheets.map((sheet) => (
                <details
                  key={sheet.name}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                  open={currentGradeSheetNames.has(sheet.name)}
                >
                  <summary className="cursor-pointer bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900">
                    {sheet.name}
                  </summary>
                  <div
                    className="max-h-[70vh] overflow-auto border-t border-slate-200
                      [scrollbar-gutter:stable_both-edges]
                      [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-3
                      [&::-webkit-scrollbar-track]:bg-slate-100
                      [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300
                      hover:[&::-webkit-scrollbar-thumb]:bg-slate-400"
                  >
                    {(() => {
                      const columns = buildSheetColumns(sheet.headers);
                      return (
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
                            return (
                              <th
                                key={`${sheet.name}-head-${col.colIndex}`}
                                className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700 shadow-[inset_0_-1px_0_0_rgba(226,232,240,1)]"
                              >
                                {(() => {
                                  if (normalizeHeaderName(col.header || "") === "marks") {
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
                        {sheet.rows.map((row, rowIndex) => {
                          const rowLevelValue = row[0] || "";
                          const isLegendRow = getProgressLevelKey(rowLevelValue) !== null;
                          return (
                            <tr
                              key={`${sheet.name}-row-${rowIndex}`}
                              className={`border-t border-slate-100 ${getProgressLevelRowClass(rowLevelValue)}`}
                            >
                              {isLegendRow ? (
                                <td colSpan={columns.length} className={`px-3 py-3 ${getProgressLevelCellClass(rowLevelValue)}`}>
                                  <div className="flex flex-wrap items-center gap-x-10 gap-y-1">
                                    <span className="text-base font-bold">{row[0] || " "}</span>
                                    <span className="text-base">{row[1] || " "}</span>
                                  </div>
                                </td>
                              ) : (
                                columns.map((col) => {
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
                                  return (
                                    <td
                                      key={`${sheet.name}-row-${rowIndex}-col-${colIndex}`}
                                      className={`${isRemarks ? "whitespace-normal" : "whitespace-nowrap"} px-3 py-2 ${getProgressLevelCellClass(
                                        rowLevelValue,
                                      )}`}
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
                                              className={`w-[120px] min-w-[90px] rounded-md border px-2 py-1 text-sm font-semibold ${getPercentFeedbackClass(
                                                percentage,
                                              )}`}
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
                                              rows={3}
                                              className="min-h-[2.5rem] w-[320px] min-w-[240px] resize-y rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
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
                                })
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                      );
                    })()}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
