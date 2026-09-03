"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Props = {
  initialValue: number;
};

export default function MpfRelevantIncomeThresholdEditor({ initialValue }: Props) {
  const [value, setValue] = useState(String(initialValue));
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(String(initialValue));
  }, [initialValue]);

  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      setStatus("Invalid");
      return;
    }
    setSaving(true);
    setStatus("");
    const { error } = await supabase.from("app_payroll_settings").upsert(
      {
        id: 1,
        mpf_relevant_income_threshold: n,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    setSaving(false);
    if (error) {
      setStatus(
        error.message.includes("relation") ||
          error.message.includes("does not exist") ||
          /mpf_relevant_income_threshold/i.test(error.message)
          ? "Missing column"
          : "Error",
      );
      return;
    }
    setStatus("Saved");
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 text-sm text-slate-700"
      title="If Tutor MPF is on and salary ≥ this, show 5% employer MPF and salary − MPF."
    >
      <span className="font-semibold text-slate-800">MPF if ≥</span>
      <span className="text-slate-500">HKD</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        suppressHydrationWarning
        className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-sm tabular-nums outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/25"
      />
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded-md bg-[#1d76c2] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1663a3] disabled:opacity-50"
      >
        {saving ? "…" : "Save"}
      </button>
      {status ? (
        <span className={`text-xs ${status === "Saved" ? "text-emerald-700" : "text-rose-700"}`}>{status}</span>
      ) : null}
    </div>
  );
}
