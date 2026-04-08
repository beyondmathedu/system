"use client";

import { useMemo, useState } from "react";

type Props = {
  fileName: string;
};

export default function DownloadTutorMonthlyPdfButton({ fileName }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const safeFileName = useMemo(() => {
    return String(fileName ?? "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim();
  }, [fileName]);

  async function onDownload() {
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      const el = document.getElementById("tutorMonthlyLessonRecordExport");
      if (!el) throw new Error("找不到匯出內容容器（tutorMonthlyLessonRecordExport）");

      // 先讓 React 有機會 render「Generating…」
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const mod: any = await import("html2pdf.js");
      const html2pdf = mod?.default ?? mod;

      // html2pdf 會把指定 DOM 轉成 PDF（含多頁）
      const opt: any = {
        margin: [8, 6, 10, 6],
        filename: safeFileName,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          letterRendering: true,
        },
        jsPDF: { unit: "pt", format: "a4", orientation: "landscape" },
        pagebreak: { mode: ["css", "legacy"] },
      };

      await html2pdf().set(opt).from(el).save();
    } catch (e: any) {
      setErr(String(e?.message ?? e ?? "PDF 生成失敗"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {err ? (
        <div className="max-w-[70vw] rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 shadow">
          {err}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => void onDownload()}
        disabled={busy}
        className="inline-flex items-center rounded-full bg-[#1d76c2] px-5 py-3 text-sm font-semibold text-white shadow-lg ring-1 ring-[#145a94] transition hover:bg-[#165f9d] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Generating PDF..." : "Download PDF"}
      </button>
    </div>
  );
}

