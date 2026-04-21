import { isF6Grade } from "@/lib/grade";

/**
 * 學生可見性規則：
 * - 手動 Inactive（student_visibility_modes）沿用既有邏輯；
 * - F.6 學生自該年 05-01 起自動視為 Inactive（畢業）。
 * 回傳最早生效日（字串 YYYY-MM-DD 可直接做 lexicographical compare）。
 */
export function resolveStudentInactiveEffectiveDate(input: {
  grade?: string | null;
  manualInactiveEffective?: string | null;
  year: number;
}): string | null {
  const manual = String(input.manualInactiveEffective ?? "").trim() || null;
  const auto = isF6Grade(input.grade) ? `${input.year}-05-01` : null;
  if (manual && auto) return manual < auto ? manual : auto;
  return manual || auto;
}
