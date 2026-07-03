import { supabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StudentFeeTierSettings = {
  f_low_tier_1_8: number;
  f_low_tier_9_plus: number;
  f_high_tier_1_8: number;
  f_high_tier_9_plus: number;
  lesson_tier_break_after: number;
};

/** Legacy + current price tables and cutover dates. */
export type StudentFeeTierBundle = {
  legacy: StudentFeeTierSettings;
  current: StudentFeeTierSettings;
  /** HK calendar date: from this month-end onward, everyone uses current tiers. */
  globalPriceSwitchDate: string;
  /** Student ids (one per line) that use current tiers before global switch; others stay legacy. */
  currentPriceStudentIds: string;
};

export const DEFAULT_LEGACY_FEE_TIER_SETTINGS: StudentFeeTierSettings = {
  f_low_tier_1_8: 230,
  f_low_tier_9_plus: 210,
  f_high_tier_1_8: 280,
  f_high_tier_9_plus: 250,
  lesson_tier_break_after: 8,
};

export const DEFAULT_CURRENT_FEE_TIER_SETTINGS: StudentFeeTierSettings = {
  f_low_tier_1_8: 270,
  f_low_tier_9_plus: 250,
  f_high_tier_1_8: 320,
  f_high_tier_9_plus: 300,
  lesson_tier_break_after: 8,
};

export const DEFAULT_FEE_TIER_SETTINGS = DEFAULT_LEGACY_FEE_TIER_SETTINGS;

export const DEFAULT_FEE_TIER_BUNDLE: StudentFeeTierBundle = {
  legacy: { ...DEFAULT_LEGACY_FEE_TIER_SETTINGS },
  current: { ...DEFAULT_CURRENT_FEE_TIER_SETTINGS },
  currentPriceStudentIds: "",
  globalPriceSwitchDate: "2026-09-01",
};

const TABLE = "app_student_fee_tier_settings";
const ROW_ID = 1;
const LS_KEY = "beyondmath:student_fee_tier_settings:v2";

function tierFromRow(
  row: Record<string, unknown>,
  prefix: "" | "current_",
  defaults: StudentFeeTierSettings,
): StudentFeeTierSettings {
  const num = (k: string, d: number) => {
    const v = Number(row[`${prefix}${k}`]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const br = Number(row.lesson_tier_break_after);
  const breakAfter =
    Number.isFinite(br) && br >= 1 && br <= 24
      ? Math.floor(br)
      : defaults.lesson_tier_break_after;
  return {
    f_low_tier_1_8: num("f_low_tier_1_8", defaults.f_low_tier_1_8),
    f_low_tier_9_plus: num("f_low_tier_9_plus", defaults.f_low_tier_9_plus),
    f_high_tier_1_8: num("f_high_tier_1_8", defaults.f_high_tier_1_8),
    f_high_tier_9_plus: num("f_high_tier_9_plus", defaults.f_high_tier_9_plus),
    lesson_tier_break_after: breakAfter,
  };
}

function normalizeIsoDate(raw: unknown, fallback: string): string {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return fallback;
}

import { normalizeStudentIdList } from "@/lib/studentId";

export function coerceStudentFeeTierSettings(row: Record<string, unknown>): StudentFeeTierSettings {
  return tierFromRow(row, "", DEFAULT_LEGACY_FEE_TIER_SETTINGS);
}

export function coerceStudentFeeTierBundle(row: Record<string, unknown>): StudentFeeTierBundle {
  const legacy = tierFromRow(row, "", DEFAULT_LEGACY_FEE_TIER_SETTINGS);
  const current = tierFromRow(row, "current_", DEFAULT_CURRENT_FEE_TIER_SETTINGS);
  current.lesson_tier_break_after = legacy.lesson_tier_break_after;
  return {
    legacy,
    current,
    currentPriceStudentIds: normalizeStudentIdList(
      String(row.current_price_student_ids ?? row.currentPriceStudentIds ?? ""),
    ),
    globalPriceSwitchDate: normalizeIsoDate(
      row.global_price_switch_date,
      DEFAULT_FEE_TIER_BUNDLE.globalPriceSwitchDate,
    ),
  };
}

function readFeeTierBundleFromLocalStorage(): StudentFeeTierBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) {
      const legacyRaw = window.localStorage.getItem("beyondmath:student_fee_tier_settings:v1");
      if (legacyRaw) {
        const o = JSON.parse(legacyRaw) as unknown;
        if (o && typeof o === "object") {
          const legacy = coerceStudentFeeTierSettings(o as Record<string, unknown>);
          return {
            ...DEFAULT_FEE_TIER_BUNDLE,
            legacy,
            current: { ...DEFAULT_FEE_TIER_BUNDLE.current, lesson_tier_break_after: legacy.lesson_tier_break_after },
          };
        }
      }
      return null;
    }
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    return coerceStudentFeeTierBundle(o as Record<string, unknown>);
  } catch {
    return null;
  }
}

function writeFeeTierBundleToLocalStorage(row: StudentFeeTierBundle): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(row));
}

function bundleToDbRow(bundle: StudentFeeTierBundle): Record<string, unknown> {
  const br = bundle.legacy.lesson_tier_break_after;
  bundle.current.lesson_tier_break_after = br;
  return {
    id: ROW_ID,
    f_low_tier_1_8: bundle.legacy.f_low_tier_1_8,
    f_low_tier_9_plus: bundle.legacy.f_low_tier_9_plus,
    f_high_tier_1_8: bundle.legacy.f_high_tier_1_8,
    f_high_tier_9_plus: bundle.legacy.f_high_tier_9_plus,
    current_f_low_tier_1_8: bundle.current.f_low_tier_1_8,
    current_f_low_tier_9_plus: bundle.current.f_low_tier_9_plus,
    current_f_high_tier_1_8: bundle.current.f_high_tier_1_8,
    current_f_high_tier_9_plus: bundle.current.f_high_tier_9_plus,
    lesson_tier_break_after: br,
    current_price_student_ids: bundle.currentPriceStudentIds,
    global_price_switch_date: bundle.globalPriceSwitchDate,
    updated_at: new Date().toISOString(),
  };
}

/** API／server：只讀 Supabase，失敗用預設。 */
export async function loadStudentFeeTierSettingsAdmin(
  admin: SupabaseClient,
): Promise<StudentFeeTierBundle> {
  const { data, error } = await admin.from(TABLE).select("*").eq("id", ROW_ID).maybeSingle();
  if (!error && data) {
    return coerceStudentFeeTierBundle(data as Record<string, unknown>);
  }
  return { ...DEFAULT_FEE_TIER_BUNDLE, legacy: { ...DEFAULT_FEE_TIER_BUNDLE.legacy }, current: { ...DEFAULT_FEE_TIER_BUNDLE.current } };
}

/** 先讀資料庫；無表或失敗則讀本機；再唔得用預設。 */
export async function loadStudentFeeTierSettings(): Promise<StudentFeeTierBundle> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", ROW_ID).maybeSingle();
  if (!error && data) {
    const parsed = coerceStudentFeeTierBundle(data as Record<string, unknown>);
    try {
      writeFeeTierBundleToLocalStorage(parsed);
    } catch {
      /* ignore */
    }
    return parsed;
  }
  const local = readFeeTierBundleFromLocalStorage();
  if (local) return local;
  return {
    ...DEFAULT_FEE_TIER_BUNDLE,
    legacy: { ...DEFAULT_FEE_TIER_BUNDLE.legacy },
    current: { ...DEFAULT_FEE_TIER_BUNDLE.current },
  };
}

/** 必寫本機；有表則再 upsert。無表時仍視為成功（只本機）。 */
export async function saveStudentFeeTierSettings(
  row: StudentFeeTierBundle,
): Promise<{ ok: boolean; error?: string; cloudSynced: boolean }> {
  const normalized: StudentFeeTierBundle = {
    ...row,
    currentPriceStudentIds: normalizeStudentIdList(row.currentPriceStudentIds),
    current: { ...row.current, lesson_tier_break_after: row.legacy.lesson_tier_break_after },
  };
  try {
    writeFeeTierBundleToLocalStorage(normalized);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "本機儲存失敗",
      cloudSynced: false,
    };
  }
  const payload = bundleToDbRow(normalized);
  const fullPayload = { ...payload };
  let { error } = await supabase.from(TABLE).upsert(fullPayload, { onConflict: "id" });
  if (error && /current_f_low_tier|global_price_switch|current_price_student/i.test(error.message)) {
    ({ error } = await supabase.from(TABLE).upsert(
      {
        id: ROW_ID,
        f_low_tier_1_8: row.legacy.f_low_tier_1_8,
        f_low_tier_9_plus: row.legacy.f_low_tier_9_plus,
        f_high_tier_1_8: row.legacy.f_high_tier_1_8,
        f_high_tier_9_plus: row.legacy.f_high_tier_9_plus,
        lesson_tier_break_after: row.legacy.lesson_tier_break_after,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    ));
  }
  if (error) {
    return { ok: true, cloudSynced: false };
  }
  return { ok: true, cloudSynced: true };
}

export { resolveFeeTierSettingsForStudent, studentCreatedAtToHkIsoDate } from "@/lib/studentFeePricingGrade";
