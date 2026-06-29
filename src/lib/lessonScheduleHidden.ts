/** Keys in `hiddenDates` / `hidden_dates` JSON. */

export const HIDDEN_SCHEDULE_RULE_PREFIX = "rule:";

const REGULAR_ROW_ID_RE = /^(\d{4}-\d{2}-\d{2})-regular-(.+)$/;

export function parseRegularLessonRowId(rowId: string): { dateIso: string; ruleId: string } | null {
  const m = REGULAR_ROW_ID_RE.exec(rowId);
  if (!m) return null;
  return { dateIso: m[1], ruleId: m[2] };
}

export function hiddenScheduleRuleStorageKey(ruleId: string): string {
  return `${HIDDEN_SCHEDULE_RULE_PREFIX}${ruleId}`;
}

/** Hide one regular lesson instance (rule + calendar date). */
export function hiddenScheduleRuleDateStorageKey(ruleId: string, dateIso: string): string {
  return `${HIDDEN_SCHEDULE_RULE_PREFIX}${ruleId}:${dateIso}`;
}

export function isLessonScheduleHidden(opts: {
  hiddenDates: Record<string, boolean>;
  dateIso: string;
  scheduleRuleId?: string | null;
}): boolean {
  const { hiddenDates, dateIso, scheduleRuleId } = opts;
  if (hiddenDates[dateIso]) return true;
  const id = String(scheduleRuleId ?? "").trim();
  if (!id) return false;
  if (hiddenDates[hiddenScheduleRuleDateStorageKey(id, dateIso)]) return true;
  // Legacy: hides every matching weekday for the rule.
  if (hiddenDates[hiddenScheduleRuleStorageKey(id)]) return true;
  return false;
}

export function listHiddenScheduleKeys(hiddenDates: Record<string, boolean>): string[] {
  return Object.keys(hiddenDates).filter((k) => hiddenDates[k]).sort();
}

export function formatHiddenScheduleKeyLabel(key: string): string {
  const ruleDate = /^rule:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (ruleDate) {
    return `Date ${ruleDate[2]} · rule ${ruleDate[1]}`;
  }
  if (key.startsWith(HIDDEN_SCHEDULE_RULE_PREFIX)) {
    return `Schedule rule ${key.slice(HIDDEN_SCHEDULE_RULE_PREFIX.length)} (all matching weekdays)`;
  }
  return `Date ${key}`;
}
