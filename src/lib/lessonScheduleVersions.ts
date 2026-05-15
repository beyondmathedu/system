import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";

/** 平日規則：同一 effectiveDate 為一版課表；較新生效日取代舊版（非按星期几疊加）。 */

export type LessonScheduleVersionRule = {
  effectiveDate: string;
  weekday: string;
  createdAt?: number;
  id?: string;
};

/** 當日適用的課表版本（<= dateIso 的最晚 effectiveDate）。 */
export function getActiveScheduleVersionDate(
  rules: Array<{ effectiveDate: string }>,
  dateIso: string,
): string | null {
  let latest = "";
  for (const r of rules) {
    if (r.effectiveDate <= dateIso && r.effectiveDate > latest) {
      latest = r.effectiveDate;
    }
  }
  return latest || null;
}

/** 當日適用的全部規則（同一版本可含同一星期几多個時段）。 */
export function getActiveScheduleRulesForDate<T extends LessonScheduleVersionRule>(
  sortedRulesAsc: T[],
  dateIso: string,
  versionCache?: Map<string, T[]>,
): T[] {
  const versionDate = getActiveScheduleVersionDate(sortedRulesAsc, dateIso);
  if (!versionDate) return [];
  const cached = versionCache?.get(versionDate);
  if (cached) return cached;
  const rules: T[] = [];
  for (const r of sortedRulesAsc) {
    if (r.effectiveDate === versionDate) {
      rules.push(r);
    }
  }
  versionCache?.set(versionDate, rules);
  return rules;
}

/** 當日各星期几的規則列表（同一星期几可有多條）。 */
export function buildActiveRulesByWeekdayForDate<T extends LessonScheduleVersionRule>(
  sortedRulesAsc: T[],
  dateIso: string,
  versionCache?: Map<string, T[]>,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of getActiveScheduleRulesForDate(sortedRulesAsc, dateIso, versionCache)) {
    const list = map.get(r.weekday) ?? [];
    list.push(r);
    map.set(r.weekday, list);
  }
  return map;
}

/** 常規課打勾 key；兼容舊資料只用 dateIso 的情況。 */
export function regularLessonAttendanceKey(rule: { id?: string }, dateIso: string): string {
  return rule.id ? `regular:${rule.id}` : dateIso;
}

export function isRegularLessonAttended(
  attendance: Record<string, boolean>,
  rule: { id?: string },
  dateIso: string,
): boolean {
  const key = regularLessonAttendanceKey(rule, dateIso);
  if (attendance[key]) return true;
  if (rule.id && attendance[dateIso]) return true;
  return false;
}

/** 房間／導師月度與學生課表一致的出席判斷（恆常兼容 regular:id 與 dateIso）。 */
export function isScheduleAttendanceMarked(
  attendance: Record<string, boolean>,
  opts: {
    attendanceKey: string;
    dateIso: string;
    lessonType: "恆常" | "補堂" | "加堂" | "取消" | typeof PENDING_MAKEUP_TYPE_LABEL;
    scheduleRuleId?: string;
  },
): boolean {
  const { attendanceKey, dateIso, lessonType, scheduleRuleId } = opts;
  if (lessonType === "取消" || lessonType === PENDING_MAKEUP_TYPE_LABEL) return false;
  if (lessonType === "補堂" || lessonType === "加堂") {
    return Boolean(attendance[attendanceKey]);
  }
  if (scheduleRuleId) {
    return isRegularLessonAttended(attendance, { id: scheduleRuleId }, dateIso);
  }
  return Boolean(attendance[attendanceKey]) || Boolean(attendance[dateIso]);
}
