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
      setStatus("Please enter a valid number (>= 0).");
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
          ? "Settings table is missing. Please run supabase/supabase_app_payroll_settings.sql in Supabase."
          : error.message,
      );
      return;
    }
    setStatus("Saved. Refresh each tutor monthly record page to apply.");
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <h2 className="text-sm font-bold text-slate-900">Multi-Student Slot - First-Seat Amount (Global)</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        For lessons on the same day with the same timetable time and <strong>2 or more students</strong>: the{" "}
        <strong>lowest grade student</strong> uses <strong>this amount</strong> (if grade is the same, student ID is used).
        Every other student uses that tutor's{" "}
        <a href="/tutor" className="font-medium text-[#1d76c2] hover:underline">
          Tutor
        </a>{" "}
        <strong>Junior / Senior rate</strong>. If there is only 1 student, always use the <strong>Single Student Rate</strong>.
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
            suppressHydrationWarning
            className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm tabular-nums outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/25"
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1d76c2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1663a3] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SaveIcon />
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {status ? (
        <p className={`mt-2 text-xs ${status.startsWith("Saved.") ? "text-emerald-700" : "text-rose-700"}`}>
          {status}
        </p>
      ) : null}
    </div>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
      <path d="m4.5 10 3.25 3.25L15.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
