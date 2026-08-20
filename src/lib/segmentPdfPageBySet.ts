import type { AiDetectedQuestion, QuestionDifficulty } from "@/lib/questionBankTypes";

export type TextLine = {
  y: number;
  text: string;
  xMin: number;
  xMax: number;
};

/** Beyond Math exam PDFs label each question with e.g. "Set Z/23-24/S6 Mock/I/Q7". */
export const SET_HEADER_RE = /Set\s+[A-Z]\/\d{2}-\d{2}\//i;

export function groupTextItemsIntoLines(
  items: Array<{ str: string; x: number; y: number; width: number }>,
  yTolerance = 5,
): TextLine[] {
  if (!items.length) return [];

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];
  let current: TextLine | null = null;

  for (const item of sorted) {
    const text = item.str;
    if (!text) continue;

    if (!current || Math.abs(item.y - current.y) > yTolerance) {
      if (current) lines.push(current);
      current = {
        y: item.y,
        text,
        xMin: item.x,
        xMax: item.x + item.width,
      };
    } else {
      current.text += text;
      current.xMin = Math.min(current.xMin, item.x);
      current.xMax = Math.max(current.xMax, item.x + item.width);
      current.y = (current.y + item.y) / 2;
    }
  }
  if (current) lines.push(current);

  return lines;
}

export function extractSetHeaderLabel(lineText: string): string | null {
  const match = lineText.match(/Set\s+[A-Z]\/\d{2}-\d{2}\/[^\n]+/i);
  return match ? match[0].replace(/\s+/g, " ").trim() : null;
}

export function parseSetSourceLabel(sourceLabel: string): {
  sourceLabel: string;
  sourceYear: string | null;
  examType: string | null;
  questionLabel: string;
} {
  const normalized = sourceLabel.replace(/\s+/g, " ").trim();
  const yearMatch = normalized.match(/\/(\d{2})-(\d{2})\//);
  const sourceYear = yearMatch ? `20${yearMatch[1]}-${yearMatch[2]}` : null;

  const qMatch = normalized.match(/\/Q(\d+)\s*$/i);
  const questionLabel = qMatch ? qMatch[1]! : normalized;

  let examType: string | null = null;
  if (yearMatch) {
    const afterYear = normalized.slice(normalized.indexOf(yearMatch[0]) + yearMatch[0].length);
    const parts = afterYear.split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      examType = parts.slice(0, -1).join(" / ");
    } else if (parts[0]) {
      examType = parts[0]!;
    }
  }

  return { sourceLabel: normalized, sourceYear, examType, questionLabel };
}

function parseMarksFromText(text: string): number | null {
  const match = text.match(/\((\d+)\s*marks?\)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function detectSetRegionsFromLines(
  lines: TextLine[],
  pageHeight: number,
  pageWidth: number,
  pageNumber: number,
  defaultTopic = "",
): AiDetectedQuestion[] {
  if (!lines.length || pageHeight <= 0 || pageWidth <= 0) return [];

  const setLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const label = extractSetHeaderLabel(lines[i]!.text);
    if (label) setLineIndices.push(i);
  }
  if (!setLineIndices.length) return [];

  const pagePadTop = 1.5;
  const pagePadBottom = 98.5;
  const defaultLeft = 2;
  const defaultWidth = 96;

  return setLineIndices.map((lineIdx, i) => {
    const startLine = lines[lineIdx]!;
    const nextLineIdx = setLineIndices[i + 1];
    const endLine = nextLineIdx != null ? lines[nextLineIdx]! : lines[lines.length - 1]!;

    const topPx = Math.max(0, startLine.y - 6);
    const bottomPx =
      nextLineIdx != null ? Math.max(topPx + 20, lines[nextLineIdx]!.y - 8) : pageHeight - 12;

    const blockLines = lines.slice(lineIdx, nextLineIdx ?? lines.length);
    const blockText = blockLines.map((l) => l.text).join(" ");
    const sourceLabel = extractSetHeaderLabel(startLine.text) ?? startLine.text.trim();
    const parsed = parseSetSourceLabel(sourceLabel);
    const marks = parseMarksFromText(blockText);

    const contentLeft = blockLines.reduce((min, l) => Math.min(min, l.xMin), blockLines[0]!.xMin);
    const contentRight = blockLines.reduce((max, l) => Math.max(max, l.xMax), blockLines[0]!.xMax);
    const leftPct = Math.max(0, (contentLeft / pageWidth) * 100 - 1);
    const widthPct = Math.min(100 - leftPct, ((contentRight - contentLeft) / pageWidth) * 100 + 2);

    const top = (topPx / pageHeight) * 100;
    const height = Math.max(5, ((bottomPx - topPx) / pageHeight) * 100);

    const suggestedDifficulty: QuestionDifficulty = "needs_review";

    return {
      questionLabel: parsed.questionLabel,
      top: Math.max(pagePadTop, top),
      left: Number.isFinite(leftPct) ? leftPct : defaultLeft,
      width: Number.isFinite(widthPct) && widthPct > 10 ? widthPct : defaultWidth,
      height: Math.min(pagePadBottom - top, height),
      suggestedDifficulty,
      suggestedMarks: marks,
      suggestedTopic: defaultTopic,
      suggestedSubtopic: "",
      sourceLabel: parsed.sourceLabel,
      sourceYear: parsed.sourceYear,
      examType: parsed.examType,
      aiDifficultyConfidence: null,
      needsReview: true,
    };
  });
}

export function isLikelyFullPagePlaceholder(
  questions: AiDetectedQuestion[],
  pageNumber: number,
): boolean {
  if (questions.length !== 1) return false;
  const q = questions[0]!;
  const isPageLabel = q.questionLabel === `P${pageNumber}`;
  const isLargeBox = q.width >= 85 && q.height >= 85;
  return isPageLabel && isLargeBox;
}
