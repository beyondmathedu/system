import { supabase } from "@/lib/supabase";
import type { TutorPayRates } from "@/lib/tutorMonthlyPayroll";

const TABLE = "app_payroll_settings";
const ROW_ID = 1;

/** 該導師在 Tutor 頁設定的初中／高中／單人價（latest_tutor_rates） */
export async function loadLatestTutorRates(tutorId: string): Promise<TutorPayRates> {
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

/** 多人同一時段時，排序後第一位學生的金額（全站設定；預設 120） */
export async function loadMultiStudentFirstAmount(): Promise<number> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("multi_student_first_amount")
    .eq("id", ROW_ID)
    .maybeSingle();

  if (error || !data) return 120;
  const n = Number((data as { multi_student_first_amount?: unknown }).multi_student_first_amount);
  return Number.isFinite(n) && n >= 0 ? n : 120;
}
