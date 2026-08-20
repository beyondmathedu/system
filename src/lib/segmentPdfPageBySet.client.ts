"use client";

import type { AiDetectedQuestion } from "@/lib/questionBankTypes";
import { ensurePdfWorker } from "@/lib/renderPdfPages.client";
import {
  detectSetRegionsFromLines,
  groupTextItemsIntoLines,
} from "@/lib/segmentPdfPageBySet";

/** Split one PDF page into question regions using embedded "Set …" text headers. */
export async function detectQuestionsBySetHeaders(
  file: File,
  pageNumber: number,
  defaultTopic = "",
): Promise<AiDetectedQuestion[]> {
  await ensurePdfWorker();
  const pdfjs = await import("pdfjs-dist");
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  const items: Array<{ str: string; x: number; y: number; width: number }> = [];
  for (const raw of textContent.items) {
    if (!("str" in raw) || typeof raw.str !== "string") continue;
    const transform = raw.transform;
    if (!transform || transform.length < 6) continue;

    const x = transform[4]!;
    const y = viewport.height - transform[5]!;
    const fontSize = Math.abs(transform[3]!) || Math.abs(transform[0]!) || 12;
    const width = Math.max(fontSize * 0.5, (raw.width ?? 0) * fontSize);

    items.push({ str: raw.str, x, y, width });
  }

  const lines = groupTextItemsIntoLines(items);
  return detectSetRegionsFromLines(lines, viewport.height, viewport.width, pageNumber, defaultTopic);
}
