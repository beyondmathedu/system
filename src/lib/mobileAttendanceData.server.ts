import { fetchClassroomNavLinks } from "@/lib/classroomsRegistry";
import { defaultLessonYear } from "@/lib/lessonCalendar";
import { fetchRoomScheduleAggregate, type RoomScheduleRow } from "@/lib/roomScheduleAggregate";
import { hkTodayYmd, toDayIso } from "@/lib/dayTimetableShared";
import { normalizeRoomSlug } from "@/lib/tutorRoomAccess";
import type { YearLessonState } from "@/lib/yearScheduleCore";

export type MobileAttendanceRow = RoomScheduleRow & {
  roomSlug: string;
};

export type MobileAttendancePayload = {
  dateIso: string;
  year: number;
  month: number;
  rows: MobileAttendanceRow[];
  yearStatesByStudentId: Record<string, YearLessonState>;
  loadError: string | null;
};

/** Today's lessons across the tutor's allowed classroom slugs (attendance + summary). */
export async function loadMobileAttendanceToday(
  allowedRoomSlugs: string[],
): Promise<MobileAttendancePayload> {
  const { y, m, d } = hkTodayYmd();
  const dateIso = toDayIso(y, m, d);
  const year = defaultLessonYear();
  const month = m;
  const slugs = [...new Set(allowedRoomSlugs.map(normalizeRoomSlug).filter(Boolean))];
  if (!slugs.length) {
    return {
      dateIso,
      year,
      month,
      rows: [],
      yearStatesByStudentId: {},
      loadError: null,
    };
  }

  const navLinks = await fetchClassroomNavLinks();
  const labelBySlug = new Map(
    navLinks.map((l) => [normalizeRoomSlug(l.href.replace(/^\/rooms\//, "")), l.label] as const),
  );

  const results = await Promise.all(
    slugs.map(async (slug) => {
      const agg = await fetchRoomScheduleAggregate(slug, year, month, {
        startIso: dateIso,
        endIso: dateIso,
      });
      return { slug, agg };
    }),
  );

  const yearStatesByStudentId: Record<string, YearLessonState> = {};
  const rows: MobileAttendanceRow[] = [];
  let loadError: string | null = null;

  for (const { slug, agg } of results) {
    if (agg.loadError && !loadError) loadError = agg.loadError;
    Object.assign(yearStatesByStudentId, agg.yearStatesByStudentId);
    for (const r of agg.rows) {
      if (r.lessonType === "取消") continue;
      rows.push({
        ...r,
        roomSlug: slug,
        room: agg.roomLabel || labelBySlug.get(slug) || r.room,
      });
    }
  }

  rows.sort((a, b) => {
    const tc = a.sortTime.localeCompare(b.sortTime);
    if (tc !== 0) return tc;
    const rc = a.room.localeCompare(b.room, "en");
    if (rc !== 0) return rc;
    return a.studentName.localeCompare(b.studentName, "zh-HK");
  });

  return { dateIso, year, month, rows, yearStatesByStudentId, loadError };
}
