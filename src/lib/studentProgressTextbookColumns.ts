import {
  formatTextbookPublisherValue,
  resolveTextbookSelection,
} from "@/lib/textbookPublisherCatalog";

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

export function selectTextbookColumnPair(
  pairs: TextbookColumnPair[],
  textbookPublisher: string,
  grade: string,
): TextbookColumnPair | null {
  if (!pairs.length) return null;
  if (pairs.length === 1) return pairs[0];

  const resolved = resolveTextbookSelection(grade, textbookPublisher);
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
    const key = normalizeMatchKey(candidate);
    const match = pairs.find((pair) => pair.label && normalizeMatchKey(pair.label) === key);
    if (match) return match;
  }

  if (resolved.book) {
    const bookKey = normalizeMatchKey(resolved.book.title);
    const fuzzy = pairs.find(
      (pair) => pair.label && normalizeMatchKey(pair.label).includes(bookKey),
    );
    if (fuzzy) return fuzzy;
  }

  return pairs.find((pair) => pair.label === null) ?? pairs[0] ?? null;
}

export function getTextbookColumnDisplayLabel(textbookPublisher: string, grade: string): string {
  const resolved = resolveTextbookSelection(grade, textbookPublisher);
  if (resolved.book?.title) return resolved.book.title;
  if (resolved.publisher) return resolved.publisher;
  return "Textbook";
}

export function buildProgressSheetColumns(
  headers: string[],
  options?: { textbookPublisher?: string; grade?: string },
): ProgressSheetColumn[] {
  const pairs = findTextbookColumnPairs(headers);
  const selectedPair = selectTextbookColumnPair(
    pairs,
    options?.textbookPublisher ?? "",
    options?.grade ?? "",
  );
  const selectedIndexes = selectedPair
    ? new Set([selectedPair.colIndexEn, selectedPair.colIndexZh])
    : new Set<number>();
  const displayLabel =
    selectedPair?.label ||
    getTextbookColumnDisplayLabel(options?.textbookPublisher ?? "", options?.grade ?? "");

  const cols: ProgressSheetColumn[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const cur = headers[i] ?? "";
    const next = headers[i + 1] ?? "";
    if (isTextbookHeader(cur) && isTextbookHeader(next)) {
      if (selectedPair && i === selectedPair.colIndexEn) {
        cols.push({
          kind: "textbookCombined",
          headerEn: selectedPair.headerEn,
          headerZh: selectedPair.headerZh,
          colIndexEn: selectedPair.colIndexEn,
          colIndexZh: selectedPair.colIndexZh,
          displayLabel,
        });
      }
      i += 1;
      continue;
    }
    if (selectedIndexes.has(i)) continue;
    cols.push({ kind: "normal", header: cur, colIndex: i });
  }
  return cols;
}
