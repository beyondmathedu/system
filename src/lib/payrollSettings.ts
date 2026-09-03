import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type { TutorPayRates } from "@/lib/tutorMonthlyPayroll";

const TABLE = "app_payroll_settings";
const ROW_ID = 1;

export const DEFAULT_MULTI_STUDENT_FIRST_AMOUNT = 120;
export const DEFAULT_MPF_RELEVANT_INCOME_THRESHOLD = 7100;

export type AppPayrollSettings = {
  multiStudentFirstAmount: number;
  mpfRelevantIncomeThreshold: number;
};

/** 該導師在 Tutor 頁設定的初中／高中／單人價（latest_tutor_rates） */
export async function loadLatestTutorRates(tutorId: string): Promise<TutorPayRates> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("latest_tutor_rates")
    .select("junior_rate, senior_rate, single_student_rate")
    .eq("tutor_id", tutorId)
    .maybeSingle();

  const row = data as
    | { junior_rate?: unknown; senior_rate?: unknown; single_student_rate?: unknown }
    | null
    | undefined;
  return {
    junior: Math.max(0, Number(row?.junior_rate ?? 0) || 0),
    senior: Math.max(0, Number(row?.senior_rate ?? 0) || 0),
    single: Math.max(0, Number(row?.single_student_rate ?? 0) || 0),
  };
}

function parseNonNeg(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** 全站薪金設定（第一席位金額 + MPF 門檻） */
export async function loadPayrollSettings(): Promise<AppPayrollSettings> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("multi_student_first_amount, mpf_relevant_income_threshold")
    .eq("id", ROW_ID)
    .maybeSingle();

  if (error || !data) {
    return {
      multiStudentFirstAmount: DEFAULT_MULTI_STUDENT_FIRST_AMOUNT,
      mpfRelevantIncomeThreshold: DEFAULT_MPF_RELEVANT_INCOME_THRESHOLD,
    };
  }
  const row = data as {
    multi_student_first_amount?: unknown;
    mpf_relevant_income_threshold?: unknown;
  };
  return {
    multiStudentFirstAmount: parseNonNeg(
      row.multi_student_first_amount,
      DEFAULT_MULTI_STUDENT_FIRST_AMOUNT,
    ),
    mpfRelevantIncomeThreshold: parseNonNeg(
      row.mpf_relevant_income_threshold,
      DEFAULT_MPF_RELEVANT_INCOME_THRESHOLD,
    ),
  };
}

/** 多人同一時段時，排序後第一位學生的金額（全站設定；預設 120） */
export async function loadMultiStudentFirstAmount(): Promise<number> {
  const settings = await loadPayrollSettings();
  return settings.multiStudentFirstAmount;
}

/** 月薪 ≥ 此金額（且導師開了 MPF）才顯示僱主 MPF 行；預設 7100 */
export async function loadMpfRelevantIncomeThreshold(): Promise<number> {
  const settings = await loadPayrollSettings();
  return settings.mpfRelevantIncomeThreshold;
}
