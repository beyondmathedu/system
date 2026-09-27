"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppTopNav from "@/components/AppTopNav";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { formatGradeDisplay } from "@/lib/grade";
import type {
  PromotionPreviewAction,
  PromotionPreviewResult,
  PromotionPreviewRow,
} from "@/lib/previewStudentGradePromotion";

const ACTION_LABEL: Record<PromotionPreviewAction, string> = {
  promote: "升班",
  repeat: "留班",
  sync_from_history: "跟 History",
  graduate_f6: "F6 畢業隱藏",
  unchanged: "不變",
};

export default function GradePromotionPreviewClient({
  navViewer = null,
}: {
  navViewer?: AppTopNavViewer | null;
}) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PromotionPreviewResult | null>(null);
  const [filter, setFilter] = useState<"all" | PromotionPreviewAction>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await fetch(`/api/admin/grade-promotion-preview?year=${year}`, {
          credentials: "same-origin",
        });
        const body = (await res.json()) as {
          ok?: boolean;
          preview?: PromotionPreviewResult;
          error?: string;
        };
        if (!res.ok || !body.ok || !body.preview) {
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        if (!cancelled) setPreview(body.preview);
      } catch (e) {
        if (!cancelled) {
          setPreview(null);
          setError(e instanceof Error ? e.message : "載入失敗");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);

  const rows = useMemo(() => {
    const all = preview?.rows ?? [];
    if (filter === "all") return all;
    return all.filter((r) => r.action === filter);
  }, [preview, filter]);

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1200px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="students" viewer={navViewer} />

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div
            className="rounded-t-2xl px-6 py-5 text-white"
            style={{ backgroundImage: PRIMARY_GRADIENT }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/students"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xl font-bold leading-none hover:bg-white/30"
                aria-label="Back to students"
              >
                ←
              </Link>
              <h1 className="text-2xl font-bold tracking-tight">升班預覽（只讀）</h1>
            </div>
            <p className="mt-2 text-sm text-blue-100">
              解決咩：9/1 自動升班前先睇名單，避免暑假 F.1 被誤升成 F.2（Daily／History
              同 Info 不一致）。只讀預覽，唔會改資料；正式執行仍靠 cron。
            </p>
          </div>

          <div className="space-y-4 p-6">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-slate-700">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Promotion year</span>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value) || year)}
                  className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              {preview ? (
                <p className="text-sm text-slate-600">
                  新學年 <span className="font-semibold">{preview.newAy}</span>
                  {preview.alreadyRun ? (
                    <span className="ml-2 font-semibold text-amber-700">（今年已執行過升班）</span>
                  ) : null}
                </p>
              ) : null}
            </div>

            {preview ? (
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    [
                      "all",
                      "全部有變更",
                      preview.counts.promote +
                        preview.counts.repeat +
                        preview.counts.sync_from_history +
                        preview.counts.graduate_f6,
                    ],
                    ["promote", "升班", preview.counts.promote],
                    ["repeat", "留班", preview.counts.repeat],
                    ["sync_from_history", "跟 History", preview.counts.sync_from_history],
                    ["graduate_f6", "F6 畢業", preview.counts.graduate_f6],
                  ] as const
                ).map(([key, label, count]) => {
                  const active = filter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                        active
                          ? "bg-[#1d76c2] text-white"
                          : "border border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      {label}
                      <span
                        className={`min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center tabular-nums ${
                          active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {loading ? (
              <p className="text-sm text-slate-500">載入中…</p>
            ) : error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">ID</th>
                      <th className="px-3 py-2">姓名</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">To</th>
                      <th className="px-3 py-2">動作</th>
                      <th className="px-3 py-2">說明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row: PromotionPreviewRow) => (
                      <tr key={row.studentId} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <Link
                            href={`/students/${encodeURIComponent(row.studentId)}/lessons`}
                            className="font-medium text-[#1d76c2] hover:underline"
                          >
                            {row.studentId}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-slate-800">
                          {row.nameZh}
                          {row.nicknameEn ? ` ${row.nicknameEn}` : ""}
                        </td>
                        <td className="px-3 py-2">{formatGradeDisplay(row.fromGrade)}</td>
                        <td className="px-3 py-2 font-semibold">{formatGradeDisplay(row.toGrade)}</td>
                        <td className="px-3 py-2">{ACTION_LABEL[row.action]}</td>
                        <td className="px-3 py-2 text-slate-600">{row.reason}</td>
                      </tr>
                    ))}
                    {!rows.length ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          沒有符合篩選的變更。
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
