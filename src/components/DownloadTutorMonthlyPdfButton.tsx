"use client";

import { useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type Props = {
  fileName: string;
  head: string[];
  body: Array<Array<string | number>>;
};

export default function DownloadTutorMonthlyPdfButton({ fileName, head, body }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hint, setHint] = useState("");

  const safeFileName = useMemo(() => {
    return String(fileName ?? "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim();
  }, [fileName]);

  async function onDownload() {
    if (busy) return;
    setErr("");
    setHint("");
    setBusy(true);
    try {
      if (!head?.length) throw new Error("PDF 表頭為空");
      if (!body?.length) throw new Error("PDF 沒有資料可匯出");

      setHint("正在生成 PDF…");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
      doc.setFontSize(10);
      autoTable(doc, {
        head: [head],
        body,
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 3, overflow: "linebreak" },
        headStyles: { fillColor: [29, 118, 194], textColor: 255 },
        margin: { top: 24, left: 18, right: 18, bottom: 18 },
        tableWidth: "auto",
      });

      const ua = navigator.userAgent || "";
      const isIOS =
        /iPad|iPhone|iPod/.test(ua) ||
        // iPadOS 13+ 可能會顯示成 Mac
        (ua.includes("Mac") && typeof document !== "undefined" && "ontouchend" in document);

      if (isIOS) {
        setHint("已生成 PDF（iOS 會用新分頁開啟預覽）…");
        const blob = doc.output("blob");
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        doc.save(safeFileName);
      }
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
      {hint ? (
        <div className="max-w-[70vw] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow">
          {hint}
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

