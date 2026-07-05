import { isF6Grade } from "@/lib/grade";

/**
 * 學生可見性規則：
 * - 手動 Inactive（student_visibility_modes）沿用既有邏輯；
 * - F.6 學生自該年 05-01 起自動視為 Inactive（畢業）。
 * 回傳最早生效日（字串 YYYY-MM-DD 可直接做 lexicographical compare）。
 */
export function normalizeOptionalIsoDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function daysBetweenIso(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00+08:00`);
  const end = Date.parse(`${endIso}T00:00:00+08:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Detail line for home dashboard inactive-return reminders. */
export function formatStudentReactivateReminderDetail(reactivateDate: string, ymdToday: string): string {
  if (reactivateDate === ymdToday) {
    return "今日預計恢復上堂 — 請到 Lessons 改回 Active";
  }
  if (reactivateDate < ymdToday) {
    const days = daysBetweenIso(reactivateDate, ymdToday);
    return `已過預計復課日 ${reactivateDate}（${days} 天前）— 仍未改回 Active`;
  }
  const daysUntil = daysBetweenIso(ymdToday, reactivateDate);
  if (daysUntil === 1) return `明天（${reactivateDate}）恢復上堂 — 請預留改回 Active`;
  return `${daysUntil} 日後恢復（${reactivateDate}）— 請預留改回 Active 及課表`;
}

export function compareStudentReactivateReminders(a: string, b: string, ymdToday: string): number {
  const rank = (iso: string) => {
    if (iso < ymdToday) return 0;
    if (iso === ymdToday) return 1;
    return 2;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}
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
