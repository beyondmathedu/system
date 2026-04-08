"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Props = {
  initialValue: number;
};

export default function MultiStudentFirstAmountEditor({ initialValue }: Props) {
  const [value, setValue] = useState(String(initialValue));
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(String(initialValue));
  }, [initialValue]);

  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      setStatus("請輸入有效數字（≥ 0）");
      return;
    }
    setSaving(true);
    setStatus("");
    const { error } = await supabase.from("app_payroll_settings").upsert(
      {
        id: 1,
        multi_student_first_amount: n,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    setSaving(false);
    if (error) {
      setStatus(
        error.message.includes("relation") || error.message.includes("does not exist")
          ? "資料表尚未建立：請在 Supabase 執行 supabase/supabase_app_payroll_settings.sql"
          : error.message,
      );
      return;
    }
    setStatus("已儲存。重新整理各導師月表即可套用。");
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <h2 className="text-sm font-bold text-slate-900">多人時段 · 第一席位金額（全站）</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        同一日、課表「時間」相同且<strong>有 2 位或以上</strong>學生時：<strong>年級最高者</strong>使用<strong>此金額</strong>（同年級則依學號）；其餘每位依該導師在{" "}
        <a href="/tutor" className="font-medium text-[#1d76c2] hover:underline">
          Tutor
        </a>{" "}
        的<strong>初中價／高中價</strong>。僅 1 位學生時一律用<strong>單人價</strong>。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <span className="whitespace-nowrap">HKD</span>
          <input
            type="number"
            min={0}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm tabular-nums outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/25"
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
      </div>
      {status ? (
        <p className={`mt-2 text-xs ${status.startsWith("已儲存") ? "text-emerald-700" : "text-rose-700"}`}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
