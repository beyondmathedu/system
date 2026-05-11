"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { DayTimetableStyleSettings } from "@/lib/dayTimetableStyleSettings";
import { DEFAULT_DAY_TIMETABLE_STYLE } from "@/lib/dayTimetableStyleSettings";
import type { DayTimetableUiLocale } from "@/lib/dayTimetableUiStrings";
import { dayTimetableStyleEditorStrings } from "@/lib/dayTimetableUiStrings";
import { notifyScheduleCachesStale } from "@/lib/scheduleCacheClient";

type Props = {
  initial: DayTimetableStyleSettings;
  uiLocale?: DayTimetableUiLocale;
};

function normalizeHexInput(v: string): string {
  const s = v.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return s;
}

export default function DayTimetableStyleEditor({ initial, uiLocale = "zh" }: Props) {
  const te = dayTimetableStyleEditorStrings[uiLocale];
  const router = useRouter();
  const [settings, setSettings] = useState<DayTimetableStyleSettings>(initial);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSettings(initial);
  }, [initial]);

  async function save() {
    setSaving(true);
    setStatus("");
    const row = {
      id: 1,
      reschedule_cell_bg_hex: normalizeHexInput(settings.rescheduleCellBgHex),
      extra_cell_bg_hex: normalizeHexInput(settings.extraCellBgHex),
      fee_unpaid_stripe_hex: normalizeHexInput(settings.feeUnpaidStripeHex),
      fee_arrears_stripe_hex: normalizeHexInput(settings.feeArrearsStripeHex),
      fee_lookback_months: Math.min(24, Math.max(2, Math.floor(settings.feeLookbackMonths))),
      fee_heavy_unpaid_threshold: Math.min(24, Math.max(1, Math.floor(settings.feeHeavyUnpaidThreshold))),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("app_day_timetable_settings").upsert(row, { onConflict: "id" });
    setSaving(false);
    if (error) {
      setStatus(
        error.message.includes("app_day_timetable_settings") || error.message.includes("does not exist")
          ? te.sqlError
          : error.message,
      );
      return;
    }
    setStatus(te.saved);
    notifyScheduleCachesStale();
    router.refresh();
  }

  function resetDefaults() {
    setSettings({ ...DEFAULT_DAY_TIMETABLE_STYLE });
  }

  const field = (label: string, hint: string, node: ReactNode) => (
    <label className="block text-xs text-slate-700">
      <span className="font-semibold text-slate-800">{label}</span>
      {hint ? <span className="ml-1 font-normal text-slate-500">{hint}</span> : null}
      <div className="mt-1">{node}</div>
    </label>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">{te.title}</h2>
        <button
          type="button"
          onClick={resetDefaults}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          {te.reset}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-600">{te.intro}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field(
          te.rescheduleBg,
          "",
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={te.ariaReschedBg}
              value={
                /^#[0-9A-Fa-f]{6}$/.test(settings.rescheduleCellBgHex)
                  ? settings.rescheduleCellBgHex
                  : "#ede9fe"
              }
              onChange={(e) =>
                setSettings((p) => ({ ...p, rescheduleCellBgHex: normalizeHexInput(e.target.value) }))
              }
              className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            />
            <input
              type="text"
              value={settings.rescheduleCellBgHex}
              onChange={(e) => setSettings((p) => ({ ...p, rescheduleCellBgHex: e.target.value }))}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
              spellCheck={false}
            />
          </div>,
        )}
        {field(
          te.extraBg,
          "",
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={te.ariaExtraBg}
              value={
                /^#[0-9A-Fa-f]{6}$/.test(settings.extraCellBgHex) ? settings.extraCellBgHex : "#fef3c7"
              }
              onChange={(e) =>
                setSettings((p) => ({ ...p, extraCellBgHex: normalizeHexInput(e.target.value) }))
              }
              className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            />
            <input
              type="text"
              value={settings.extraCellBgHex}
              onChange={(e) => setSettings((p) => ({ ...p, extraCellBgHex: e.target.value }))}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
              spellCheck={false}
            />
          </div>,
        )}
        {field(
          te.feeUnpaid,
          "",
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={te.ariaFeeUnpaid}
              value={
                /^#[0-9A-Fa-f]{6}$/.test(settings.feeUnpaidStripeHex)
                  ? settings.feeUnpaidStripeHex
                  : "#f59e0b"
              }
              onChange={(e) =>
                setSettings((p) => ({ ...p, feeUnpaidStripeHex: normalizeHexInput(e.target.value) }))
              }
              className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            />
            <input
              type="text"
              value={settings.feeUnpaidStripeHex}
              onChange={(e) => setSettings((p) => ({ ...p, feeUnpaidStripeHex: e.target.value }))}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
              spellCheck={false}
            />
          </div>,
        )}
        {field(
          te.feeArrears,
          "",
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={te.ariaFeeArrears}
              value={
                /^#[0-9A-Fa-f]{6}$/.test(settings.feeArrearsStripeHex)
                  ? settings.feeArrearsStripeHex
                  : "#e11d48"
              }
              onChange={(e) =>
                setSettings((p) => ({ ...p, feeArrearsStripeHex: normalizeHexInput(e.target.value) }))
              }
              className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            />
            <input
              type="text"
              value={settings.feeArrearsStripeHex}
              onChange={(e) => setSettings((p) => ({ ...p, feeArrearsStripeHex: e.target.value }))}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
              spellCheck={false}
            />
          </div>,
        )}
        {field(
          te.lookback,
          te.lookbackHint,
          <input
            type="number"
            min={2}
            max={24}
            value={settings.feeLookbackMonths}
            onChange={(e) =>
              setSettings((p) => ({ ...p, feeLookbackMonths: Number(e.target.value) || p.feeLookbackMonths }))
            }
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm tabular-nums"
          />,
        )}
        {field(
          te.threshold,
          te.thresholdHint,
          <input
            type="number"
            min={1}
            max={24}
            value={settings.feeHeavyUnpaidThreshold}
            onChange={(e) =>
              setSettings((p) => ({
                ...p,
                feeHeavyUnpaidThreshold: Number(e.target.value) || p.feeHeavyUnpaidThreshold,
              }))
            }
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm tabular-nums"
          />,
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-[#1d76c2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#165f9d] disabled:opacity-60"
        >
          {saving ? te.saving : te.save}
        </button>
        {status ? <span className="text-xs text-slate-600">{status}</span> : null}
      </div>
    </div>
  );
}
