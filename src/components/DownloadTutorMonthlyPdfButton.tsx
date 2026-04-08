"use client";

import { useMemo, useState } from "react";
import html2pdf from "html2pdf.js";

type Props = {
  fileName: string;
};

export default function DownloadTutorMonthlyPdfButton({ fileName }: Props) {
  const [busy, setBusy] = useState(false);

  const safeFileName = useMemo(() => {
    return String(fileName ?? "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim();
  }, [fileName]);

  async function onDownload() {
    if (busy) return;
    setBusy(true);
    try {
      const el = document.getElementById("tutorMonthlyLessonRecordExport");
      if (!el) throw new Error("找不到匯出內容容器（tutorMonthlyLessonRecordExport）");

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onDownload()}
      disabled={busy}
      className="fixed bottom-6 right-6 z-50 inline-flex items-center rounded-full bg-[#1d76c2] px-5 py-3 text-sm font-semibold text-white shadow-lg ring-1 ring-[#145a94] transition hover:bg-[#165f9d] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? "Generating PDF..." : "Download PDF"}
    </button>
  );
}

