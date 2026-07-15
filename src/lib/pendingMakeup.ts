/**
 * Pending makeup (leave / 補堂待定) policy — keyed by **original lesson month** (fromDate).
 *
 * Example: leave on any May lesson (fromDate in May)
 * - Through end of June (M+1): open — can arrange reschedule
 * - From 1 July (M+2): locked — no edits; still visible as overdue
 * - From 1 August (M+3): hidden from UI (DB entry kept)
 */

export const PENDING_MAKEUP_BUTTON_LABEL = "Leave / pending makeup";
/** 首頁等繁中介面 */
export const PENDING_MAKEUP_BUTTON_LABEL_ZH = "請假／補堂待定";
/** Badge in lesson-type column */
export const PENDING_MAKEUP_TYPE_LABEL = "Pending makeup";

/** Months after original-lesson month when reschedule/edits stop (M+2 → July for May). */
export const PENDING_MAKEUP_LOCK_AFTER_MONTHS = 2;
/** Months after original-lesson month when admin/UI hide the row (M+3 → August for May). */
export const PENDING_MAKEUP_HIDE_AFTER_MONTHS = 3;

export type RescheduleEntryLike = {
  id?: string;
  fromDate?: string;
  toDate?: string;
  time?: string;
  room?: string;
  pending?: boolean;
};

export type PendingMakeupPhase = "open" | "locked" | "hidden";

const EN_MONTH = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

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

function parseIsoYearMonth(iso: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

export function addCalendarMonths(
  year: number,
  month1to12: number,
  delta: number,
): { year: number; month: number } {
  const idx = year * 12 + (month1to12 - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function toIsoYmd(year: number, month1to12: number, day: number): string {
  return `${year}-${String(month1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** End of original month M+1 — last day to arrange makeup. */
export function pendingMakeupOpenUntilEndIso(fromDate: string): string | null {
  const ym = parseIsoYearMonth(fromDate);
  if (!ym) return null;
  const end = addCalendarMonths(ym.year, ym.month, 1);
  return toIsoYmd(end.year, end.month, lastDayOfMonth(end.year, end.month));
}

/** First day of M+2 — edits locked. */
export function pendingMakeupLockStartIso(fromDate: string): string | null {
  const ym = parseIsoYearMonth(fromDate);
  if (!ym) return null;
  const lock = addCalendarMonths(ym.year, ym.month, PENDING_MAKEUP_LOCK_AFTER_MONTHS);
  return toIsoYmd(lock.year, lock.month, 1);
}

/** First day of M+3 — hidden from UI. */
export function pendingMakeupHideStartIso(fromDate: string): string | null {
  const ym = parseIsoYearMonth(fromDate);
  if (!ym) return null;
  const hide = addCalendarMonths(ym.year, ym.month, PENDING_MAKEUP_HIDE_AFTER_MONTHS);
  return toIsoYmd(hide.year, hide.month, 1);
}

export function getPendingMakeupPhase(
  fromDate: string,
  todayYmd: string,
): PendingMakeupPhase {
  const hideStart = pendingMakeupHideStartIso(fromDate);
  const lockStart = pendingMakeupLockStartIso(fromDate);
  if (!hideStart || !lockStart) return "locked";
  if (todayYmd >= hideStart) return "hidden";
  if (todayYmd >= lockStart) return "locked";
  return "open";
}

export function isPendingMakeupEditable(fromDate: string, todayYmd: string): boolean {
  return getPendingMakeupPhase(fromDate, todayYmd) === "open";
}

export function isPendingMakeupVisible(fromDate: string, todayYmd: string): boolean {
  return getPendingMakeupPhase(fromDate, todayYmd) !== "hidden";
}

/** e.g. "Makeup until end of June", "Reschedule deadline passed" */
export function formatPendingMakeupReminder(fromDate: string, todayYmd: string): string {
  const phase = getPendingMakeupPhase(fromDate, todayYmd);
  if (phase !== "open") return "Reschedule deadline passed";
  const until = pendingMakeupOpenUntilEndIso(fromDate);
  const ym = until ? parseIsoYearMonth(until) : null;
  if (!ym) return "Makeup window open";
  return `Makeup until end of ${EN_MONTH[ym.month]}`;
}

/** 例：「可補至 6 月底」「已過補堂限期」 */
export function formatPendingMakeupReminderZh(fromDate: string, todayYmd: string): string {
  const phase = getPendingMakeupPhase(fromDate, todayYmd);
  if (phase !== "open") return "已過補堂限期";
  const until = pendingMakeupOpenUntilEndIso(fromDate);
  const ym = until ? parseIsoYearMonth(until) : null;
  if (!ym) return "補堂限期內";
  return `可補至 ${ym.month} 月底`;
}

export function formatPendingMakeupFromDateLabel(fromDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromDate);
  if (!m) return fromDate;
  return `${Number(m[3])}/${Number(m[2])}`;
}

export function pendingMakeupLockedMessage(fromDate: string): string {
  const until = pendingMakeupOpenUntilEndIso(fromDate);
  const ym = until ? parseIsoYearMonth(until) : null;
  const untilLabel = ym ? `end of ${EN_MONTH[ym.month]}` : "the makeup deadline";
  return `Reschedule deadline passed (makeup was allowed until ${untilLabel}). Record kept; no further changes.`;
}
