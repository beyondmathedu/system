"use client";

import { useMemo, useState } from "react";

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

      setHint("正在開啟列印視窗（可另存為 PDF）…");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const escapeHtml = (s: string) =>
        s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const rowsHtml = body
        .map(
          (r) =>
            `<tr>${r
              .map((c) => `<td>${escapeHtml(String(c ?? ""))}</td>`)
              .join("")}</tr>`,
        )
        .join("");

      const headHtml = `<tr>${head.map((h) => `<th>${escapeHtml(String(h ?? ""))}</th>`).join("")}</tr>`;

      const html = `<!doctype html>
<html lang="zh-HK">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(safeFileName)}</title>
    <style>
      @page { size: A4 portrait; margin: 12mm; }
      html, body { background: #fff; }
      body { font-family: system-ui, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", Arial, sans-serif; color: #111; }
      h1 { font-size: 14px; margin: 0 0 8px 0; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #d0d7de; padding: 6px 6px; font-size: 10px; vertical-align: top; word-break: break-word; }
      th { background: #1d76c2; color: #fff; font-weight: 700; }
      .note { margin-top: 8px; font-size: 10px; color: #555; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(safeFileName.replace(/\\.pdf$/i, ""))}</h1>
    <table>
      <thead>${headHtml}</thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="note">提示：在列印視窗選擇「另存為 PDF」即可下載。</div>
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () { window.print(); }, 200);
      });
    </script>
  </body>
</html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (!w) {
        URL.revokeObjectURL(url);
        throw new Error("瀏覽器阻擋彈出視窗，請允許 Pop-up 後再試");
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);

      setHint("已開啟列印視窗：請選擇「另存為 PDF」");
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

