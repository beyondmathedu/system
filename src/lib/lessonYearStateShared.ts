export type StudentLesson2026State = {
  attendance: Record<string, boolean>;
  hiddenDates: Record<string, boolean>;
  overrides: Record<string, unknown>;
  rescheduleEntries: unknown[];
  extraEntries: unknown[];
};

export type LessonYearStateField = keyof StudentLesson2026State;

export const ALL_LESSON_YEAR_STATE_FIELDS: LessonYearStateField[] = [
  "attendance",
  "hiddenDates",
  "overrides",
  "rescheduleEntries",
  "extraEntries",
];

export function lessonYearStateFieldsFromPatch(
  patch: Partial<StudentLesson2026State>,
): LessonYearStateField[] {
  return ALL_LESSON_YEAR_STATE_FIELDS.filter((field) => patch[field] !== undefined);
}

export const DEFAULT_LESSON_YEAR_STATE: StudentLesson2026State = {
  attendance: {},
  hiddenDates: {},
  overrides: {},
  rescheduleEntries: [],
  extraEntries: [],
};

function coerceRescheduleEntriesFromDb(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!id) continue;
    out.push({
      ...o,
      id,
      fromDate: String(o.fromDate ?? ""),
      toDate: String(o.toDate ?? ""),
      time: String(o.time ?? ""),
      room: String(o.room ?? ""),
    });
  }
  return out;
}

function coerceExtraEntriesFromDb(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!id) continue;
    out.push({
      ...o,
      id,
      date: String(o.date ?? ""),
      time: String(o.time ?? ""),
      room: String(o.room ?? ""),
    });
  }
  return out;
}

/** 由 `student_lessons_year_state` 列轉成前端 state（Realtime / REST 共用） */
export function parseLessonYearStateDbRow(row: Record<string, unknown>): StudentLesson2026State {
  return {
    attendance:
      row.attendance && typeof row.attendance === "object"
        ? (row.attendance as Record<string, boolean>)
        : {},
    hiddenDates:
      row.hidden_dates && typeof row.hidden_dates === "object"
        ? (row.hidden_dates as Record<string, boolean>)
        : {},
    overrides:
      row.overrides && typeof row.overrides === "object"
        ? (row.overrides as Record<string, unknown>)
        : {},
    // JSONB ids may arrive as numbers — always normalize to string for rowId / edit matching.
    rescheduleEntries: coerceRescheduleEntriesFromDb(row.reschedule_entries),
    extraEntries: coerceExtraEntriesFromDb(row.extra_entries),
  };
}
