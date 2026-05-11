import { supabase } from "@/lib/supabase";

/** 學費粗算結果；與底色分開 */
export type DayTimetableFeePaymentTone = "ok" | "unpaid_current" | "many_months_unpaid";

export type DayTimetableStyleSettings = {
  rescheduleCellBgHex: string;
  extraCellBgHex: string;
  feeUnpaidStripeHex: string;
  feeArrearsStripeHex: string;
  feeLookbackMonths: number;
  feeHeavyUnpaidThreshold: number;
};

export const DEFAULT_DAY_TIMETABLE_STYLE: DayTimetableStyleSettings = {
  rescheduleCellBgHex: "#ede9fe",
  extraCellBgHex: "#fef3c7",
  feeUnpaidStripeHex: "#f59e0b",
  feeArrearsStripeHex: "#e11d48",
  feeLookbackMonths: 6,
  feeHeavyUnpaidThreshold: 3,
};

const TABLE = "app_day_timetable_settings";

function normalizeHex(raw: unknown, fallback: string): string {
  const s = String(raw ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return fallback;
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function rowToSettings(row: Record<string, unknown> | null | undefined): DayTimetableStyleSettings {
  if (!row) return { ...DEFAULT_DAY_TIMETABLE_STYLE };
  const d = DEFAULT_DAY_TIMETABLE_STYLE;
  return {
    rescheduleCellBgHex: normalizeHex(row.reschedule_cell_bg_hex, d.rescheduleCellBgHex),
    extraCellBgHex: normalizeHex(row.extra_cell_bg_hex, d.extraCellBgHex),
    feeUnpaidStripeHex: normalizeHex(row.fee_unpaid_stripe_hex, d.feeUnpaidStripeHex),
    feeArrearsStripeHex: normalizeHex(row.fee_arrears_stripe_hex, d.feeArrearsStripeHex),
    feeLookbackMonths: clampInt(Number(row.fee_lookback_months), 2, 24, d.feeLookbackMonths),
    feeHeavyUnpaidThreshold: clampInt(Number(row.fee_heavy_unpaid_threshold), 1, 24, d.feeHeavyUnpaidThreshold),
  };
}

/** 讀取課表顏色／學費門檻；表或欄位不存在時回傳預設 */
export async function loadDayTimetableStyleSettings(): Promise<DayTimetableStyleSettings> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", 1).maybeSingle();
  if (error) {
    const msg = error.message ?? "";
    if (/\b(app_day_timetable_settings|relation)\b/i.test(msg) && /\b(not exist|does not exist)\b/i.test(msg)) {
      return { ...DEFAULT_DAY_TIMETABLE_STYLE };
    }
    return { ...DEFAULT_DAY_TIMETABLE_STYLE };
  }
  return rowToSettings(data as Record<string, unknown>);
}
