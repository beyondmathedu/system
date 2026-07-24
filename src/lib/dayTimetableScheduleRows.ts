/**
 * Maps yearScheduleCore rows to the daily / regular timetable cell shape.
 */

import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import {
  buildYearScheduleRowsForDateRange,
  type BuiltScheduleRow,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";
import type { RoomSlotTutorRule } from "@/lib/roomSlotTutorRules";

export type DayTimetableBuiltRow = {
  date: string;
  time: string;
  room: string;
  lessonType: "恆常" | "補堂" | "加堂" | "取消" | typeof PENDING_MAKEUP_TYPE_LABEL;
  tutorDisplay: string;
  noteDisplay: string;
  pendingMakeupLabel?: string;
};

function yearFromIso(dateIso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  return m ? Number(m[1]) : 2026;
}

function mapCoreRowToDayRow(row: BuiltScheduleRow): DayTimetableBuiltRow {
  return {
    date: row.date,
    time: row.time || "待定",
    room: row.room,
    lessonType: row.lessonType,
    tutorDisplay: row.tutorDisplay,
    noteDisplay: row.noteDisplay,
  };
}

export function buildDayTimetableRowsForDate(
  records: YearLessonRecord[],
  state: YearLessonState,
  targetDateIso: string,
  _todayYmd: string,
  options?: { roomSlotTutorRules?: RoomSlotTutorRule[] },
): DayTimetableBuiltRow[] {
  const year = yearFromIso(targetDateIso);
  const coreRows = buildYearScheduleRowsForDateRange(
    records,
    state,
    year,
    targetDateIso,
    targetDateIso,
    { roomSlotTutorRules: options?.roomSlotTutorRules },
  );
  return coreRows
    .map((row) => mapCoreRowToDayRow(row))
    .filter((row) => row.lessonType !== PENDING_MAKEUP_TYPE_LABEL);
}
