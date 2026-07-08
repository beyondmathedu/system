import { hkYmdNow } from "@/lib/lessonCalendar";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today as YYYY-MM-DD in Hong Kong. */
export function hkTodayIso(now = new Date()): string {
  const { y, m, d } = hkYmdNow(now);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** True when exam date is today or later (HK). Empty/invalid → false. */
export function isUpcomingExamDate(examDateIso: string, todayIso = hkTodayIso()): boolean {
  const trimmed = examDateIso.trim();
  if (!ISO_DATE_RE.test(trimmed)) return false;
  return trimmed >= todayIso;
}

/** For read-only surfaces: return exam date only while it is still upcoming. */
export function visibleExamDateIso(examDateIso: string, todayIso = hkTodayIso()): string {
  const trimmed = examDateIso.trim();
  return isUpcomingExamDate(trimmed, todayIso) ? trimmed : "";
}

export function visibleExamContent(
  examDateIso: string,
  examContent: string,
  todayIso = hkTodayIso(),
): string {
  return isUpcomingExamDate(examDateIso, todayIso) ? examContent.trim() : "";
}

/** M/D display; empty when exam date has passed. */
export function formatVisibleExamDateSlashed(examDateIso: string, todayIso = hkTodayIso()): string {
  const visible = visibleExamDateIso(examDateIso, todayIso);
  if (!visible) return "";
  const m = ISO_DATE_RE.exec(visible);
  if (!m) return visible;
  return `${Number(m[2])}/${Number(m[3])}`;
}
