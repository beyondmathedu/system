import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { defaultLessonYear } from "@/lib/lessonCalendar";
import { loadLessonScheduleRecordsServer, loadLessonYearStateServer } from "@/lib/lessonDataServer";
import { loadRoomSlotTutorRulesCached } from "@/lib/roomSlotTutorRules";
import { hkTodayYmd, toDayIso } from "@/lib/dayTimetableShared";
import {
  buildYearScheduleRowsForDateRange,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";
import { normalizeLessonRecords } from "@/lib/yearScheduleData.server";

export type MobileStudentLessonCard = {
  rowId: string;
  dateIso: string;
  time: string;
  room: string;
  tutorDisplay: string;
  lessonType: string;
  noteDisplay: string;
};

function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Upcoming lessons for the logged-in student (read-only phone view). */
export async function loadMobileStudentUpcoming(
  studentId: string,
  daysAhead = 21,
): Promise<{ dateIso: string; endIso: string; year: number; rows: MobileStudentLessonCard[]; loadError: string | null }> {
  const { y, m, d } = hkTodayYmd();
  const dateIso = toDayIso(y, m, d);
  const endIso = addDaysIso(dateIso, daysAhead);
  const year = defaultLessonYear();

  try {
    const supabase = await createSupabaseServerClient();
    const [recordsRaw, state, roomSlotTutorRules] = await Promise.all([
      loadLessonScheduleRecordsServer(supabase, studentId),
      loadLessonYearStateServer(supabase, studentId, year),
      loadRoomSlotTutorRulesCached(),
    ]);
    const records = normalizeLessonRecords(recordsRaw) as YearLessonRecord[];
    const yearState: YearLessonState = {
      attendance: state.attendance ?? {},
      hiddenDates: state.hiddenDates ?? {},
      overrides: (state.overrides ?? {}) as YearLessonState["overrides"],
      rescheduleEntries: (state.rescheduleEntries ?? []) as YearLessonState["rescheduleEntries"],
      extraEntries: (state.extraEntries ?? []) as YearLessonState["extraEntries"],
    };

    const built = buildYearScheduleRowsForDateRange(records, yearState, year, dateIso, endIso, {
      roomSlotTutorRules,
    });

    const rows: MobileStudentLessonCard[] = built
      .filter((r) => r.lessonType !== "取消")
      .map((r) => ({
        rowId: r.rowId,
        dateIso: r.date,
        time: r.time,
        room: r.room,
        tutorDisplay: r.tutorDisplay,
        lessonType: r.lessonType,
        noteDisplay: r.noteDisplay,
      }));

    return { dateIso, endIso, year, rows, loadError: null };
  } catch (e) {
    return {
      dateIso,
      endIso,
      year,
      rows: [],
      loadError: e instanceof Error ? e.message : "Failed to load schedule",
    };
  }
}
