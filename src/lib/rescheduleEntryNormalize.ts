import {
  buildYearScheduleRows,
  rescheduleEntryHasFromSlot,
  type YearLessonRecord,
  type YearLessonRescheduleEntry,
  type YearLessonState,
} from "@/lib/yearScheduleCore";

export function rescheduleEntrySlotKey(e: {
  fromScheduleRuleId?: string | null;
  fromTime?: string | null;
  fromRoom?: string | null;
}): string {
  const ruleId = String(e.fromScheduleRuleId ?? "").trim();
  if (ruleId) return `rule:${ruleId}`;
  const time = String(e.fromTime ?? "").trim();
  const room = String(e.fromRoom ?? "").trim();
  return `slot:${time}|${room}`;
}

export function scheduleRowSlotKey(row: {
  scheduleRuleId?: string;
  baseTime?: string;
  time?: string;
  baseRoom?: string;
  room?: string;
}): string {
  const ruleId = String(row.scheduleRuleId ?? "").trim();
  if (ruleId) return `rule:${ruleId}`;
  const time = String(row.baseTime ?? row.time ?? "").trim();
  const room = String(row.baseRoom ?? row.room ?? "").trim();
  return `slot:${time}|${room}`;
}

export function fromSlotFieldsFromScheduleRow(row: {
  scheduleRuleId?: string;
  baseTime?: string;
  time?: string;
  baseRoom?: string;
  room?: string;
}): Pick<YearLessonRescheduleEntry, "fromScheduleRuleId" | "fromTime" | "fromRoom"> {
  const fromScheduleRuleId = String(row.scheduleRuleId ?? "").trim();
  const fromTime = String(row.baseTime || row.time || "").trim();
  const fromRoom = String(row.baseRoom || row.room || "").trim();
  return {
    ...(fromScheduleRuleId ? { fromScheduleRuleId } : {}),
    ...(fromTime ? { fromTime } : {}),
    ...(fromRoom ? { fromRoom } : {}),
  };
}

function baseRegularLessonState(
  hiddenDates: YearLessonState["hiddenDates"],
  overrides: YearLessonState["overrides"],
): YearLessonState {
  return {
    attendance: {},
    hiddenDates,
    overrides,
    rescheduleEntries: [],
    extraEntries: [],
  };
}

/** Count regular slots per calendar date (ignoring reschedule/cancelled rows). */
export function regularSlotCountByDate(
  records: YearLessonRecord[],
  hiddenDates: YearLessonState["hiddenDates"],
  overrides: YearLessonState["overrides"],
  targetYear: number,
): Map<string, number> {
  const rows = buildYearScheduleRows(
    records,
    baseRegularLessonState(hiddenDates, overrides),
    targetYear,
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.lessonType !== "恆常") continue;
    map.set(r.date, (map.get(r.date) ?? 0) + 1);
  }
  return map;
}

type BaseSlot = { scheduleRuleId?: string; time: string; room: string };

function baseRegularSlotsByDate(
  records: YearLessonRecord[],
  hiddenDates: YearLessonState["hiddenDates"],
  overrides: YearLessonState["overrides"],
  targetYear: number,
): Map<string, BaseSlot[]> {
  const rows = buildYearScheduleRows(
    records,
    baseRegularLessonState(hiddenDates, overrides),
    targetYear,
  );
  const map = new Map<string, BaseSlot[]>();
  for (const r of rows) {
    if (r.lessonType !== "恆常") continue;
    const list = map.get(r.date) ?? [];
    list.push({
      scheduleRuleId: r.scheduleRuleId,
      time: r.time,
      room: r.room,
    });
    map.set(r.date, list);
  }
  return map;
}

/** Upgrade legacy whole-day entries; drop orphans on multi-lesson dates. */
export function normalizeRescheduleEntriesForSchedule(
  entries: YearLessonRescheduleEntry[],
  records: YearLessonRecord[],
  hiddenDates: YearLessonState["hiddenDates"],
  overrides: YearLessonState["overrides"],
  targetYear: number,
): YearLessonRescheduleEntry[] {
  if (!entries.length || !records.length) return entries;
  const countByDate = regularSlotCountByDate(records, hiddenDates, overrides, targetYear);
  const slotsByDate = baseRegularSlotsByDate(records, hiddenDates, overrides, targetYear);
  const out: YearLessonRescheduleEntry[] = [];

  for (const e of entries) {
    if (rescheduleEntryHasFromSlot(e)) {
      out.push(e);
      continue;
    }
    const count = countByDate.get(e.fromDate) ?? 1;
    if (count > 1) continue;
    const base = slotsByDate.get(e.fromDate)?.[0];
    if (!base) {
      out.push(e);
      continue;
    }
    out.push({
      ...e,
      ...(base.scheduleRuleId ? { fromScheduleRuleId: base.scheduleRuleId } : {}),
      ...(base.time ? { fromTime: base.time } : {}),
      ...(base.room ? { fromRoom: base.room } : {}),
    });
  }
  return out;
}

export function rescheduleEntryBlocksNewSlot(
  existing: YearLessonRescheduleEntry,
  opts: {
    fromDate: string;
    fromSlotKey: string;
    editingId?: string | null;
    sameDateRegularSlotCount: number;
  },
): boolean {
  if (opts.editingId && existing.id === opts.editingId) return false;
  if (existing.fromDate !== opts.fromDate) return false;
  if (!rescheduleEntryHasFromSlot(existing)) {
    return opts.sameDateRegularSlotCount <= 1;
  }
  return rescheduleEntrySlotKey(existing) === opts.fromSlotKey;
}

export function upsertRescheduleEntry(
  entries: YearLessonRescheduleEntry[],
  entry: YearLessonRescheduleEntry,
  sameDateRegularSlotCount: number,
): YearLessonRescheduleEntry[] {
  let base = entries.filter((e) => e.id !== entry.id);
  if (sameDateRegularSlotCount > 1 && rescheduleEntryHasFromSlot(entry)) {
    base = base.filter((e) => e.fromDate !== entry.fromDate || rescheduleEntryHasFromSlot(e));
  }
  return [...base, entry];
}
