import { supabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StudentFeeTierSettings = {
  f_low_tier_1_8: number;
  f_low_tier_9_plus: number;
  f_high_tier_1_8: number;
  f_high_tier_9_plus: number;
  lesson_tier_break_after: number;
};

export const DEFAULT_FEE_TIER_SETTINGS: StudentFeeTierSettings = {
  f_low_tier_1_8: 230,
  f_low_tier_9_plus: 210,
  f_high_tier_1_8: 280,
  f_high_tier_9_plus: 250,
  lesson_tier_break_after: 8,
};

const TABLE = "app_student_fee_tier_settings";
const ROW_ID = 1;
const LS_KEY = "beyondmath:student_fee_tier_settings:v1";

export function coerceStudentFeeTierSettings(row: Record<string, unknown>): StudentFeeTierSettings {
  const num = (k: string, d: number) => {
    const v = Number(row[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const br = Number(row.lesson_tier_break_after);
  const breakAfter =
    Number.isFinite(br) && br >= 1 && br <= 24
      ? Math.floor(br)
      : DEFAULT_FEE_TIER_SETTINGS.lesson_tier_break_after;
  return {
    f_low_tier_1_8: num("f_low_tier_1_8", DEFAULT_FEE_TIER_SETTINGS.f_low_tier_1_8),
    f_low_tier_9_plus: num("f_low_tier_9_plus", DEFAULT_FEE_TIER_SETTINGS.f_low_tier_9_plus),
    f_high_tier_1_8: num("f_high_tier_1_8", DEFAULT_FEE_TIER_SETTINGS.f_high_tier_1_8),
    f_high_tier_9_plus: num("f_high_tier_9_plus", DEFAULT_FEE_TIER_SETTINGS.f_high_tier_9_plus),
    lesson_tier_break_after: breakAfter,
  };
}

function readFeeTierSettingsFromLocalStorage(): StudentFeeTierSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    return coerceStudentFeeTierSettings(o as Record<string, unknown>);
  } catch {
    return null;
  }
}

function writeFeeTierSettingsToLocalStorage(row: StudentFeeTierSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(row));
}

/** API／server：只讀 Supabase，失敗用預設。 */
export async function loadStudentFeeTierSettingsAdmin(
  admin: SupabaseClient,
): Promise<StudentFeeTierSettings> {
  const { data, error } = await admin.from(TABLE).select("*").eq("id", ROW_ID).maybeSingle();
  if (!error && data) {
    return coerceStudentFeeTierSettings(data as Record<string, unknown>);
  }
  return { ...DEFAULT_FEE_TIER_SETTINGS };
}

/** 先讀資料庫；無表或失敗則讀本機；再唔得用預設。 */
export async function loadStudentFeeTierSettings(): Promise<StudentFeeTierSettings> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", ROW_ID).maybeSingle();
  if (!error && data) {
    const parsed = coerceStudentFeeTierSettings(data as Record<string, unknown>);
    try {
      writeFeeTierSettingsToLocalStorage(parsed);
    } catch {
      /* ignore */
    }
    return parsed;
  }
  const local = readFeeTierSettingsFromLocalStorage();
  if (local) return local;
  return { ...DEFAULT_FEE_TIER_SETTINGS };
}

/** 必寫本機；有表則再 upsert。無表時仍視為成功（只本機）。 */
export async function saveStudentFeeTierSettings(
  row: StudentFeeTierSettings,
): Promise<{ ok: boolean; error?: string; cloudSynced: boolean }> {
  try {
    writeFeeTierSettingsToLocalStorage(row);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "本機儲存失敗",
      cloudSynced: false,
    };
  }
  const { error } = await supabase.from(TABLE).upsert(
    {
      id: ROW_ID,
      f_low_tier_1_8: row.f_low_tier_1_8,
      f_low_tier_9_plus: row.f_low_tier_9_plus,
      f_high_tier_1_8: row.f_high_tier_1_8,
      f_high_tier_9_plus: row.f_high_tier_9_plus,
      lesson_tier_break_after: row.lesson_tier_break_after,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    return { ok: true, cloudSynced: false };
  }
  return { ok: true, cloudSynced: true };
}
