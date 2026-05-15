/** 原課日起計，須於此日數內安排補堂（含原課當日為第 0 天） */
export const PENDING_MAKEUP_WITHIN_DAYS = 5;

/** Button / panel title (2026 lesson schedule) */
export const PENDING_MAKEUP_BUTTON_LABEL = "Leave / pending makeup";
/** 首頁等繁中介面 */
export const PENDING_MAKEUP_BUTTON_LABEL_ZH = "請假／補堂待定";
/** Badge in lesson-type column */
export const PENDING_MAKEUP_TYPE_LABEL = "Pending makeup";

export type RescheduleEntryLike = {
  id?: string;
  fromDate?: string;
  toDate?: string;
  time?: string;
  room?: string;
  pending?: boolean;
};

export function isPendingRescheduleEntry(e: RescheduleEntryLike): boolean {
  if (e.pending === true) return true;
  return !String(e.toDate ?? "").trim();
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00+08:00`).getTime();
  const b = new Date(`${toIso}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86400000);
}

/** 自原課日起已過日數（原課日 = 0） */
export function daysSinceFromDate(fromDate: string, todayYmd: string): number {
  return Math.max(0, daysBetweenIso(fromDate, todayYmd));
}

/** e.g. "Make up within 3 days", "Make up today", "2 days overdue" */
export function formatPendingMakeupReminder(
  fromDate: string,
  todayYmd: string,
  withinDays: number = PENDING_MAKEUP_WITHIN_DAYS,
): string {
  const elapsed = daysSinceFromDate(fromDate, todayYmd);
  const remaining = withinDays - elapsed;
  if (remaining > 1) return `Make up within ${remaining} days`;
  if (remaining === 1) return "Make up within 1 day";
  if (remaining === 0) return "Make up today";
  const overdue = elapsed - withinDays;
  return overdue === 1 ? "1 day overdue" : `${overdue} days overdue`;
}

/** 例：「3 天內待補」「今日內待補」「逾期 2 天待補」 */
export function formatPendingMakeupReminderZh(
  fromDate: string,
  todayYmd: string,
  withinDays: number = PENDING_MAKEUP_WITHIN_DAYS,
): string {
  const elapsed = daysSinceFromDate(fromDate, todayYmd);
  const remaining = withinDays - elapsed;
  if (remaining > 1) return `${remaining} 天內待補`;
  if (remaining === 1) return "1 天內待補";
  if (remaining === 0) return "今日內待補";
  const overdue = elapsed - withinDays;
  return overdue === 1 ? "逾期 1 天待補" : `逾期 ${overdue} 天待補`;
}

export function formatPendingMakeupFromDateLabel(fromDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromDate);
  if (!m) return fromDate;
  return `${Number(m[2])}/${Number(m[3])}`;
}
