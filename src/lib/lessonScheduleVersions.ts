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
  const weekday = normalizeScheduleWeekday(rule.weekday);
  return `${weekday}|${String(rule.time).trim()}|${canonicalScheduleRoomLabel(rule.room)}`;
}

/** Stable React list key — unique even when legacy patch ids collide across weekdays. */
export function scheduleRecordRowKey(rule: {
  id?: string;
  effectiveDate?: string;
  weekday: string;
  time: string;
  room: string;
}): string {
  const id = String(rule.id ?? "").trim();
  const slot = scheduleSlotKey(rule);
  const eff = String(rule.effectiveDate ?? "").trim();
  return id ? `${id}|${slot}|${eff}` : `${slot}|${eff}`;
}

const WEEKDAY_ID_TOKEN: Record<string, string> = {
  日: "0",
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
};

/** ASCII token for rule ids (avoids stripping Chinese weekdays to `_`). */
export function scheduleRuleSlotIdToken(rule: {
  weekday: string;
  time: string;
  room: string;
}): string {
  const wd =
    WEEKDAY_ID_TOKEN[normalizeScheduleWeekday(rule.weekday)] ??
    normalizeScheduleWeekday(rule.weekday);
  const time = String(rule.time).trim().replace(/[^a-zA-Z0-9]/g, "_");
  const room = canonicalScheduleRoomLabel(rule.room).replace(/[^a-zA-Z0-9]/g, "_");
  return `wd${wd}-${time}-${room}`;
}

/**
 * Fix records that share the same `id` but represent different weekday/time/room slots.
 * (Legacy May 2026 tutor patch ids stripped Chinese weekdays, causing collisions.)
 */
export function repairCollidingScheduleRuleIds<T extends LessonScheduleSlotRule>(
  rules: T[],
): { rules: T[]; repairedCount: number } {
  const seenIds = new Set<string>();
  const out: T[] = [];
  let repairedCount = 0;

  for (const r of rules) {
    const id = String(r.id ?? "").trim();
    if (!id) {
      out.push(r);
      continue;
    }

    if (!seenIds.has(id)) {
      seenIds.add(id);
      out.push(r);
      continue;
    }

    const existing = out.find((x) => x.id === id);
    if (existing && scheduleSlotKey(existing) === scheduleSlotKey(r)) {
      const idx = out.indexOf(existing);
      if (idx >= 0) out[idx] = pickPreferredDuplicateScheduleRule(existing, r);
      continue;
    }

    const token = scheduleRuleSlotIdToken(r);
    let newId = `${id}__${token}`;
    let suffix = 2;
    while (seenIds.has(newId)) {
      newId = `${id}__${token}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(newId);
    out.push({ ...r, id: newId });
    repairedCount += 1;
  }

  return { rules: out, repairedCount };
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
  formatRoom?: (room: string) => string,
): string {
  const wd = weekdayLabel ? weekdayLabel(rule.weekday) : rule.weekday;
  const tutor = String(rule.tutor ?? "").trim();
  const room = formatRoom ? formatRoom(rule.room) : rule.room;
  return `${wd} ${rule.time} · ${room}${tutor ? ` · ${tutor}` : ""}`;
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

export function attendanceAfterRescheduleDelete(
  attendance: Record<string, boolean>,
  entry: {
    id: string;
    fromDate: string;
    fromScheduleRuleId?: string | null;
    fromTime?: string | null;
    fromRoom?: string | null;
  },
): Record<string, boolean> {
  const next = { ...attendance };
  const rescheduleKey = `reschedule:${entry.id}`;
  const wasMarked = Boolean(next[rescheduleKey]);
  delete next[rescheduleKey];

  const slotKey = cancelledOriginalSlotKey({
    baseRuleId: entry.fromScheduleRuleId,
    time: entry.fromTime,
    room: entry.fromRoom,
  });
  delete next[buildCancelledOriginalAttendanceKey(entry.id, entry.fromDate, slotKey)];

  if (!wasMarked) return next;

  const regularKey = entry.fromScheduleRuleId
    ? regularLessonAttendanceKey({ id: entry.fromScheduleRuleId }, entry.fromDate)
    : entry.fromDate;
  return attendanceAfterRegularToggle(next, regularKey, true);
}

export function deleteRescheduleEntryAndAttendance(
  attendance: Record<string, boolean>,
  rescheduleEntries: Array<{
    id: string;
    fromDate: string;
    toDate: string;
    time: string;
    room: string;
    pending?: boolean;
    fromScheduleRuleId?: string | null;
    fromTime?: string | null;
    fromRoom?: string | null;
  }>,
  entryId: string,
): {
  attendance: Record<string, boolean>;
  rescheduleEntries: Array<{
    id: string;
    fromDate: string;
    toDate: string;
    time: string;
    room: string;
    pending?: boolean;
    fromScheduleRuleId?: string | null;
    fromTime?: string | null;
    fromRoom?: string | null;
  }>;
} {
  const targetId = String(entryId);
  const entry = rescheduleEntries.find((e) => String(e.id) === targetId);
  if (!entry) {
    return { attendance: { ...attendance }, rescheduleEntries };
  }

  const nextAttendance = { ...attendance };
  delete nextAttendance[`reschedule:${entry.id}`];
  const slotKey = cancelledOriginalSlotKey({
    baseRuleId: entry.fromScheduleRuleId,
    time: entry.fromTime,
    room: entry.fromRoom,
  });
  delete nextAttendance[buildCancelledOriginalAttendanceKey(entry.id, entry.fromDate, slotKey)];

  if (entry.pending) {
    return {
      attendance: nextAttendance,
      rescheduleEntries: rescheduleEntries.filter((e) => String(e.id) !== targetId),
    };
  }

  return {
    attendance: nextAttendance,
    rescheduleEntries: rescheduleEntries.map((e) =>
      String(e.id) === targetId
        ? {
            ...e,
            toDate: "",
            pending: true,
          }
        : e,
    ),
  };
}

export function deleteExtraEntryAndAttendance(
  attendance: Record<string, boolean>,
  extraEntries: Array<{
    id: string;
    date: string;
    time: string;
    room: string;
    originDate?: string;
    originTime?: string;
    originRoom?: string;
    pending?: boolean;
  }>,
  entryId: string,
): {
  attendance: Record<string, boolean>;
  extraEntries: Array<{
    id: string;
    date: string;
    time: string;
    room: string;
    originDate?: string;
    originTime?: string;
    originRoom?: string;
    pending?: boolean;
  }>;
} {
  const targetId = String(entryId);
  const entry = extraEntries.find((e) => String(e.id) === targetId);
  const nextAttendance = { ...attendance };
  const attendanceKey = `extra:${targetId}`;
  delete nextAttendance[attendanceKey];

  if (!entry) {
    return { attendance: nextAttendance, extraEntries };
  }

  const originDate = String(entry.originDate ?? "").trim();
  const moved = Boolean(originDate && originDate !== entry.date);
  if (!moved) {
    return {
      attendance: nextAttendance,
      extraEntries: extraEntries.filter((e) => String(e.id) !== targetId),
    };
  }

  const restored = {
    ...entry,
    date: originDate,
    time: String(entry.originTime ?? "").trim() || entry.time,
    room: String(entry.originRoom ?? "").trim() || entry.room,
    pending: true,
  };
  delete restored.originDate;
  delete restored.originTime;
  delete restored.originRoom;

  return {
    attendance: nextAttendance,
    extraEntries: extraEntries.map((e) => (String(e.id) === targetId ? restored : e)),
  };
}

/**
 * Cancelled-original row identity. Include slotKey so two lessons on the same
 * fromDate (e.g. double weekly slots) do not share a React key.
 */
export function cancelledOriginalSlotKey(slot: {
  baseRuleId?: string | null;
  time?: string;
  room?: string;
  fallbackRowId?: string;
}): string {
  const ruleId = String(slot.baseRuleId ?? "").trim();
  if (ruleId) return ruleId;
  const time = String(slot.time ?? "").trim();
  const room = String(slot.room ?? "").trim();
  if (time || room) return `${time}|${room}`;
  return String(slot.fallbackRowId ?? "slot").trim() || "slot";
}

export function buildCancelledOriginalRowId(
  entryId: string,
  fromDate: string,
  slotKey: string,
): string {
  return `cancelled-${entryId}-${fromDate}-${slotKey}`;
}

export function buildCancelledOriginalAttendanceKey(
  entryId: string,
  fromDate: string,
  slotKey: string,
): string {
  return `cancelled:${fromDate}:${entryId}:${slotKey}`;
}

/** Parse cancelled-original rowId; supports legacy `cancelled-{id}-{date}` without slot. */
export function parseCancelledOriginalRowId(
  rowId: string,
): { entryId: string; fromDate: string; slotKey: string } | null {
  const m = /^cancelled-(.+)-(\d{4}-\d{2}-\d{2})(?:-(.+))?$/.exec(String(rowId ?? ""));
  if (!m) return null;
  return {
    entryId: m[1],
    fromDate: m[2],
    slotKey: m[3] ?? "",
  };
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
