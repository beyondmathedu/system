import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import { canonicalScheduleRoomLabel } from "@/lib/dayTimetableShared";

/** 平日規則：同一 effectiveDate 為一版課表；較新生效日取代舊版（非按星期几疊加）。 */

/** Map Mon/Monday/星期一 → 一 for schedule row expansion. */
export function normalizeScheduleWeekday(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (["一", "二", "三", "四", "五", "六", "日"].includes(s)) return s;
  if (s.startsWith("星期")) {
    const c = s.slice(2, 3);
    if (["一", "二", "三", "四", "五", "六", "日"].includes(c)) return c;
  }
  const lower = s.toLowerCase();
  if (lower === "mon" || lower === "monday") return "一";
  if (lower === "tue" || lower === "tuesday") return "二";
  if (lower === "wed" || lower === "wednesday") return "三";
  if (lower === "thu" || lower === "thursday") return "四";
  if (lower === "fri" || lower === "friday") return "五";
  if (lower === "sat" || lower === "saturday") return "六";
  if (lower === "sun" || lower === "sunday") return "日";
  return s;
}

export type LessonScheduleVersionRule = {
  effectiveDate: string;
  weekday: string;
  createdAt?: number;
  id?: string;
};

export type LessonScheduleSlotRule = LessonScheduleVersionRule & {
  time: string;
  room: string;
  tutor?: string;
};

export function scheduleSlotKey(rule: { weekday: string; time: string; room: string }): string {
  return `${rule.weekday}|${String(rule.time).trim()}|${canonicalScheduleRoomLabel(rule.room)}`;
}

export type DuplicateScheduleRuleGroup<T extends LessonScheduleSlotRule> = {
  effectiveDate: string;
  weekday: string;
  time: string;
  room: string;
  rules: T[];
  keep: T;
  remove: T[];
};

export function findDuplicateScheduleRuleGroups<T extends LessonScheduleSlotRule>(
  rules: T[],
): DuplicateScheduleRuleGroup<T>[] {
  const byVersion = new Map<string, T[]>();
  for (const r of rules) {
    const list = byVersion.get(r.effectiveDate) ?? [];
    list.push(r);
    byVersion.set(r.effectiveDate, list);
  }
  const groups: DuplicateScheduleRuleGroup<T>[] = [];
  for (const [effectiveDate, list] of byVersion) {
    const bySlot = new Map<string, T[]>();
    for (const r of list) {
      const key = scheduleSlotKey(r);
      const slotList = bySlot.get(key) ?? [];
      slotList.push(r);
      bySlot.set(key, slotList);
    }
    for (const slotRules of bySlot.values()) {
      if (slotRules.length <= 1) continue;
      const keep = slotRules.reduce((best, r) => pickPreferredDuplicateScheduleRule(best, r));
      groups.push({
        effectiveDate,
        weekday: slotRules[0].weekday,
        time: slotRules[0].time,
        room: slotRules[0].room,
        rules: slotRules,
        keep,
        remove: slotRules.filter((r) => r.id !== keep.id),
      });
    }
  }
  groups.sort((a, b) => {
    const ed = a.effectiveDate.localeCompare(b.effectiveDate);
    if (ed !== 0) return ed;
    return scheduleSlotKey(a).localeCompare(scheduleSlotKey(b));
  });
  return groups;
}

export function hasDuplicateScheduleSlotInVersion<T extends LessonScheduleSlotRule>(
  rules: T[],
  slot: { effectiveDate: string; weekday: string; time: string; room: string },
  excludeId?: string,
): boolean {
  const key = scheduleSlotKey(slot);
  return rules.some(
    (r) =>
      r.effectiveDate === slot.effectiveDate &&
      scheduleSlotKey(r) === key &&
      (!excludeId || r.id !== excludeId),
  );
}

export function formatScheduleRuleSlotLabel(
  rule: { weekday: string; time: string; room: string; tutor?: string },
  weekdayLabel?: (wd: string) => string,
): string {
  const wd = weekdayLabel ? weekdayLabel(rule.weekday) : rule.weekday;
  const tutor = String(rule.tutor ?? "").trim();
  return `${wd} ${rule.time} · ${rule.room}${tutor ? ` · ${tutor}` : ""}`;
}

/** 同版本內：同一星期几＋時間＋房間只保留一條（優先有導師、較新）。 */
export function dedupeScheduleRulesByWeekdaySlot<T extends LessonScheduleSlotRule>(rules: T[]): T[] {
  const slotMap = new Map<string, T>();
  for (const r of rules) {
    const key = scheduleSlotKey(r);
    const existing = slotMap.get(key);
    if (!existing) {
      slotMap.set(key, r);
      continue;
    }
    slotMap.set(key, pickPreferredDuplicateScheduleRule(existing, r));
  }
  return [...slotMap.values()];
}

function pickPreferredDuplicateScheduleRule<T extends LessonScheduleSlotRule>(a: T, b: T): T {
  const aTutor = String(a.tutor ?? "").trim();
  const bTutor = String(b.tutor ?? "").trim();
  if (aTutor && !bTutor) return a;
  if (bTutor && !aTutor) return b;
  return Number(b.createdAt ?? 0) >= Number(a.createdAt ?? 0) ? b : a;
}

/** 按 effectiveDate 分組去重，回傳整理後列表與刪除條數。 */
export function pruneDuplicateScheduleRules<T extends LessonScheduleSlotRule>(
  rules: T[],
): { rules: T[]; removedCount: number } {
  const byVersion = new Map<string, T[]>();
  for (const r of rules) {
    const list = byVersion.get(r.effectiveDate) ?? [];
    list.push(r);
    byVersion.set(r.effectiveDate, list);
  }
  const kept: T[] = [];
  let removedCount = 0;
  for (const list of byVersion.values()) {
    const deduped = dedupeScheduleRulesByWeekdaySlot(list);
    removedCount += list.length - deduped.length;
    kept.push(...deduped);
  }
  kept.sort((a, b) => {
    const ed = a.effectiveDate.localeCompare(b.effectiveDate);
    if (ed !== 0) return ed;
    return Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0);
  });
  return { rules: kept, removedCount };
}

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

/** 當日適用規則；同星期几＋時間＋房間只保留一條（避免重複保存導致雙倍課堂行）。 */
export function getActiveDedupedScheduleRulesForDate<T extends LessonScheduleSlotRule>(
  sortedRulesAsc: T[],
  dateIso: string,
  versionCache?: Map<string, T[]>,
): T[] {
  return dedupeScheduleRulesByWeekdaySlot(
    getActiveScheduleRulesForDate(sortedRulesAsc, dateIso, versionCache),
  );
}

/** 當日各星期几的規則列表（同一星期几可有多條不同時段）。 */
export function buildActiveRulesByWeekdayForDate<T extends LessonScheduleSlotRule>(
  sortedRulesAsc: T[],
  dateIso: string,
  versionCache?: Map<string, T[]>,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of getActiveDedupedScheduleRulesForDate(sortedRulesAsc, dateIso, versionCache)) {
    const list = map.get(r.weekday) ?? [];
    list.push(r);
    map.set(r.weekday, list);
  }
  return map;
}

/** 讀取某日 overrides（房間頁／調堂日用 dateIso = toDate）。 */
export function readLessonDayOverrideField(
  overrides: Record<string, unknown> | undefined,
  dateIso: string,
  field: "tutor" | "lessonSummary",
): string {
  const ov = overrides?.[dateIso];
  if (!ov || typeof ov !== "object" || Array.isArray(ov)) return "";
  return String((ov as Record<string, unknown>)[field] ?? "").trim();
}

/** 導師顯示：override 優先，其次 Room 時段預設，再排課規則；調堂列用補堂日 overrides。 */
export function tutorDisplayForLessonRow(opts: {
  overrides?: Record<string, unknown>;
  dateIso: string;
  roomSlotTutor?: string;
  scheduleRuleTutor?: string;
  pendingLabel?: string;
}): string {
  const { overrides, dateIso, roomSlotTutor, scheduleRuleTutor, pendingLabel = "待定" } = opts;
  const fromOverride = readLessonDayOverrideField(overrides, dateIso, "tutor");
  if (fromOverride) return fromOverride;
  const fromSlot = String(roomSlotTutor ?? "").trim();
  if (fromSlot) return fromSlot;
  const fromRule = String(scheduleRuleTutor ?? "").trim();
  if (fromRule) return fromRule;
  return pendingLabel;
}

const REGULAR_ATTENDANCE_KEY_RE = /^regular:([^:]+):(\d{4}-\d{2}-\d{2})$/;

export function parseRegularAttendanceRuleId(attendanceKey: string): string | null {
  const m = REGULAR_ATTENDANCE_KEY_RE.exec(attendanceKey);
  return m ? m[1] : null;
}

/** Remove legacy rule-wide `regular:id` when saving a per-date regular key. */
export function attendanceAfterRegularToggle(
  attendance: Record<string, boolean>,
  attendanceKey: string,
  checked: boolean,
): Record<string, boolean> {
  const next = { ...attendance, [attendanceKey]: checked };
  const m = REGULAR_ATTENDANCE_KEY_RE.exec(attendanceKey);
  if (m) delete next[`regular:${m[1]}`];
  return next;
}

/** 常規課打勾 key（每堂獨立）；兼容舊資料 regular:id 與 dateIso。 */
export function regularLessonAttendanceKey(rule: { id?: string }, dateIso: string): string {
  return rule.id ? `regular:${rule.id}:${dateIso}` : dateIso;
}

export function isRegularLessonAttended(
  attendance: Record<string, boolean>,
  rule: { id?: string },
  dateIso: string,
): boolean {
  if (!rule.id) {
    return Boolean(attendance[dateIso]);
  }
  if (attendance[regularLessonAttendanceKey(rule, dateIso)]) return true;
  // Legacy: one key marked every matching weekday in the year.
  if (attendance[`regular:${rule.id}`]) return true;
  if (attendance[dateIso]) return true;
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
