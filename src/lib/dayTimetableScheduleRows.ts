/**
 * Maps yearScheduleCore rows to the daily / regular timetable cell shape.
 */

import { PENDING_MAKEUP_TYPE_LABEL, formatPendingMakeupReminder, isPendingMakeupVisible, isPendingRescheduleEntry } from "@/lib/pendingMakeup";
import { parseCancelledOriginalRowId } from "@/lib/lessonScheduleVersions";
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

function mapCoreRowToDayRow(
  row: BuiltScheduleRow,
  state: YearLessonState,
  todayYmd: string,
): DayTimetableBuiltRow {
  let pendingMakeupLabel: string | undefined;
  if (row.rowKind === "cancelled_original") {
    if (row.rowId.startsWith("extra-cancelled-")) {
      const extraId = row.rowId.slice("extra-cancelled-".length);
      const entry = state.extraEntries.find((e) => String(e.id) === extraId);
      if (entry?.pending) {
        pendingMakeupLabel = formatPendingMakeupReminder(entry.date, todayYmd);
      }
    } else {
      const cancelledMatch = parseCancelledOriginalRowId(row.rowId);
      if (cancelledMatch) {
        const entry = state.rescheduleEntries.find((e) => e.id === cancelledMatch.entryId);
        if (entry && isPendingRescheduleEntry(entry)) {
          pendingMakeupLabel = formatPendingMakeupReminder(entry.fromDate, todayYmd);
        }
      }
    }
  }

  return {
    date: row.date,
    time: row.time || "待定",
    room: row.room,
    lessonType: row.lessonType,
    tutorDisplay: row.tutorDisplay,
    noteDisplay: row.noteDisplay,
    pendingMakeupLabel,
  };
}

export function buildDayTimetableRowsForDate(
  records: YearLessonRecord[],
  state: YearLessonState,
  targetDateIso: string,
  todayYmd: string,
  options?: { roomSlotTutorRules?: RoomSlotTutorRule[]; includePendingMakeup?: boolean },
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
    .map((row) => mapCoreRowToDayRow(row, state, todayYmd))
    .filter((row) => {
      if (row.lessonType !== PENDING_MAKEUP_TYPE_LABEL) return true;
      if (!options?.includePendingMakeup) return false;
      return isPendingMakeupVisible(row.date, todayYmd);
    });
}
