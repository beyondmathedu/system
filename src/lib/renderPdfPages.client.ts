"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { QuestionBBox } from "@/lib/questionBankTypes";

export type RenderedPdfPage = {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
};

let pdfWorkerReady: Promise<void> | null = null;

async function ensurePdfWorker() {
  if (pdfWorkerReady) return pdfWorkerReady;
  pdfWorkerReady = (async () => {
    const pdfjs = await import("pdfjs-dist");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
    }
  })();
  return pdfWorkerReady;
}

export async function loadPdfDocument(file: File): Promise<PDFDocumentProxy> {
  await ensurePdfWorker();
  const pdfjs = await import("pdfjs-dist");
  const bytes = await file.arrayBuffer();
  const task = pdfjs.getDocument({ data: bytes });
  return task.promise;
}

export async function renderPdfPageToDataUrl(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale = 1.5,
): Promise<RenderedPdfPage> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return {
    pageNumber,
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL("image/png"),
  };
}

export async function renderFirstNPdfPages(
  file: File,
  maxPages: number,
  scale = 1.4,
): Promise<{ pages: RenderedPdfPage[]; totalPages: number }> {
  const pdf = await loadPdfDocument(file);
  const limit = Math.max(1, Math.min(maxPages, pdf.numPages));
  const pages: RenderedPdfPage[] = [];
  for (let i = 1; i <= limit; i += 1) {
    pages.push(await renderPdfPageToDataUrl(pdf, i, scale));
  }
  return { pages, totalPages: pdf.numPages };
}

export async function renderAllPdfPages(file: File, scale = 1.5): Promise<RenderedPdfPage[]> {
  const pdf = await loadPdfDocument(file);
  const out: RenderedPdfPage[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    out.push(await renderPdfPageToDataUrl(pdf, i, scale));
  }
  return out;
}

export function cropPageDataUrl(
  pageDataUrl: string,
  pageWidth: number,
  pageHeight: number,
  bbox: QuestionBBox,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const x = Math.round((bbox.left / 100) * pageWidth);
      const y = Math.round((bbox.top / 100) * pageHeight);
      const w = Math.max(1, Math.round((bbox.width / 100) * pageWidth));
      const h = Math.max(1, Math.round((bbox.height / 100) * pageHeight));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load page image for crop"));
    img.src = pageDataUrl;
  });
}
