import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type StudentGradePromotionResult = {
  run_year: number;
  promoted_count: number;
  already_run: boolean;
  skipped_before_date: boolean;
  message: string;
};

export async function runStudentGradePromotion(input?: {
  year?: number | null;
  force?: boolean;
}): Promise<StudentGradePromotionResult | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("run_student_grade_promotion", {
    p_year: input?.year ?? null,
    p_force: input?.force ?? false,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : null;
  return (row as StudentGradePromotionResult | null) ?? null;
}
