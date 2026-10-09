import {
  formatTextbookPublisherValue,
  resolveExtendedMathsTextbookSelection,
  resolveTextbookSelection,
} from "@/lib/textbookPublisherCatalog";
import { M1_SHEET, M2_SHEET } from "@/lib/studentProgressWorkbook";

export type TextbookColumnPair = {
  headerEn: string;
  headerZh: string;
  colIndexEn: number;
  colIndexZh: number;
  /** Label after "Textbook:" in the EN header, or full header when not prefixed. */
  label: string | null;
};

export type ProgressSheetColumn =
  | { kind: "normal"; header: string; colIndex: number }
  | {
      kind: "textbookCombined";
      headerEn: string;
      headerZh: string;
      colIndexEn: number;
      colIndexZh: number;
      displayLabel: string;
    };

function normalizeHeaderName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .trim();
}

/** Extract optional publisher/book label from a workbook Textbook header cell. */
export function parseTextbookHeaderLabel(header: string): string | null {
  const trimmed = String(header ?? "").trim();
  if (!trimmed) return null;

  const prefixed = /^textbook\s*:\s*(.*)$/i.exec(trimmed);
  if (prefixed) {
    const rest = prefixed[1]?.trim() ?? "";
    return rest || null;
  }

  if (/^textbook$/i.test(trimmed)) return null;
  return trimmed;
}

export function isTextbookHeader(header: string): boolean {
  const norm = normalizeHeaderName(header);
  if (norm === "textbook" || norm === "textbook:") return true;
  return /^textbook\s*:/.test(norm);
}

export function findTextbookColumnPairs(headers: string[]): TextbookColumnPair[] {
  const pairs: TextbookColumnPair[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const cur = headers[i] ?? "";
    const next = headers[i + 1] ?? "";
    if (!isTextbookHeader(cur) || !isTextbookHeader(next)) continue;
    pairs.push({
      headerEn: cur || "Textbook:",
      headerZh: next || "課本：",
      colIndexEn: i,
      colIndexZh: i + 1,
      label: parseTextbookHeaderLabel(cur),
    });
    i += 1;
  }
  return pairs;
}

function normalizeMatchKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTextbookMatchText(value: string): string {
  return normalizeMatchKey(value)
    .replace(/\bmaths\b/g, "mathematics")
    .replace(/\s*\(\s*\d+(?:st|nd|rd|th)?(?:\s*edition)?\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textbookNamesLooselyMatch(headerLabel: string, candidate: string): boolean {
  const label = normalizeTextbookMatchText(headerLabel);
  const query = normalizeTextbookMatchText(candidate);
  if (!label || !query) return false;
  return label === query || label.includes(query) || query.includes(label);
}

export type ProgressTextbookCatalog = "core" | "extended";

export function selectTextbookColumnPair(
  pairs: TextbookColumnPair[],
  textbookPublisher: string,
  grade: string,
  catalog: ProgressTextbookCatalog = "core",
): TextbookColumnPair | null {
  if (!pairs.length) return null;
  if (pairs.length === 1) return pairs[0];

  const resolved =
    catalog === "extended"
      ? resolveExtendedMathsTextbookSelection(textbookPublisher)
      : resolveTextbookSelection(grade, textbookPublisher);
  const formatted =
    resolved.publisher && resolved.book
      ? formatTextbookPublisherValue(resolved.publisher, resolved.book)
      : resolved.publisher;

  const candidates = [
    formatted,
    resolved.book?.title ?? "",
    resolved.publisher,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const match = pairs.find((pair) => pair.label && textbookNamesLooselyMatch(pair.label, candidate));
    if (match) return match;
  }

  return pairs.find((pair) => pair.label === null) ?? pairs[0] ?? null;
}

export function getTextbookColumnDisplayLabel(
  textbookPublisher: string,
  grade: string,
  catalog: ProgressTextbookCatalog = "core",
  workbookLabel?: string | null,
): string {
  const resolved =
    catalog === "extended"
      ? resolveExtendedMathsTextbookSelection(textbookPublisher)
      : resolveTextbookSelection(grade, textbookPublisher);
  const title = workbookLabel || resolved.book?.title || "";
  if (catalog === "extended" && title && resolved.publisher) {
    return `${title} (${resolved.publisher})`;
  }
  if (title) return title;
  if (resolved.publisher) return resolved.publisher;
  return "Textbook";
}

export function textbookOptionsForProgressSheet(
  sheetName: string,
  student: {
    textbookPublisher?: string;
    grade?: string;
    m1TextbookPublisher?: string;
    m2TextbookPublisher?: string;
  },
): { textbookPublisher: string; grade: string; catalog: ProgressTextbookCatalog } {
  if (sheetName === M1_SHEET) {
    return {
      textbookPublisher: student.m1TextbookPublisher ?? "",
      grade: student.grade ?? "",
      catalog: "extended",
    };
  }
  if (sheetName === M2_SHEET) {
    return {
      textbookPublisher: student.m2TextbookPublisher ?? "",
      grade: student.grade ?? "",
      catalog: "extended",
    };
  }
  return {
    textbookPublisher: student.textbookPublisher ?? "",
    grade: student.grade ?? "",
    catalog: "core",
  };
}

export function buildProgressSheetColumns(
  headers: string[],
  options?: { textbookPublisher?: string; grade?: string; catalog?: ProgressTextbookCatalog },
): ProgressSheetColumn[] {
  const catalog = options?.catalog ?? "core";
  const pairs = findTextbookColumnPairs(headers);
  const selectedPair = selectTextbookColumnPair(
    pairs,
    options?.textbookPublisher ?? "",
    options?.grade ?? "",
    catalog,
  );
  const selectedIndexes = selectedPair
    ? new Set([selectedPair.colIndexEn, selectedPair.colIndexZh])
    : new Set<number>();
  const displayLabel = getTextbookColumnDisplayLabel(
    options?.textbookPublisher ?? "",
    options?.grade ?? "",
    catalog,
    selectedPair?.label,
  );

  const textbookCol: ProgressSheetColumn | null = selectedPair
    ? {
        kind: "textbookCombined",
        headerEn: selectedPair.headerEn,
        headerZh: selectedPair.headerZh,
        colIndexEn: selectedPair.colIndexEn,
        colIndexZh: selectedPair.colIndexZh,
        displayLabel,
      }
    : null;

  const cols: ProgressSheetColumn[] = [];
  let textbookInserted = false;
  for (let i = 0; i < headers.length; i += 1) {
    const cur = headers[i] ?? "";
    const next = headers[i + 1] ?? "";
    if (isTextbookHeader(cur) && isTextbookHeader(next)) {
      i += 1;
      continue;
    }
    if (selectedIndexes.has(i)) continue;

    // Keep textbook topic column immediately left of Basic Concept (M1/M2 Excel has books after Remarks).
    if (
      textbookCol &&
      !textbookInserted &&
      normalizeHeaderName(cur) === "basic concept"
    ) {
      cols.push(textbookCol);
      textbookInserted = true;
    }
    cols.push({ kind: "normal", header: cur, colIndex: i });
  }
  if (textbookCol && !textbookInserted) {
    cols.unshift(textbookCol);
  }
  return cols;
}
