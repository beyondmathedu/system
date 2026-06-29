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
    rescheduleEntries: Array.isArray(row.reschedule_entries) ? row.reschedule_entries : [],
    extraEntries: Array.isArray(row.extra_entries) ? row.extra_entries : [],
  };
}
