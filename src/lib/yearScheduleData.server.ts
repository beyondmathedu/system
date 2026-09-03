import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { filterStudentsWithAnyActivityInYear, studentIdsOf } from "@/lib/activeStudentIds";
import { inferGradeOnDate } from "@/lib/inferStudentGrade";
import {
  buildStudentInactivePeriodsById,
  withAutoF6InactivePeriod,
  type StudentInactivePeriod,
} from "@/lib/studentVisibility";
import {
  LEGACY_2026_STATE_SELECT,
  mergeYearStatesBatchWithLegacyFallback,
  parseLegacy2026StateRows,
  studentIdsNeedingLegacyStateFallback,
} from "@/lib/lessonYearStateLegacy";
import { parseLessonYearStateDbRow } from "@/lib/lessonYearStateShared";
import { SCHEDULE_CACHE_TAG_AGGREGATES, SCHEDULE_CACHE_TAG_DAY_TIMETABLE } from "@/lib/scheduleCacheTags";
import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { YearLessonRecord, YearLessonState } from "@/lib/yearScheduleCore";

const SHARED_SCHEDULE_CACHE_TAGS = [SCHEDULE_CACHE_TAG_DAY_TIMETABLE, SCHEDULE_CACHE_TAG_AGGREGATES];

export type ScheduleStudentRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  nickname_en: string | null;
  grade: string | null;
  school: string | null;
  textbook_publisher: string | null;
};

export type YearScheduleData = {
  normalizedRecordsById: Record<string, YearLessonRecord[]>;
  stateById: Record<string, YearLessonState>;
};

export type ScheduleStudentsContext = {
  activeStudents: ScheduleStudentRow[];
  inactivePeriodsById: Map<string, StudentInactivePeriod[]>;
};

function normalizeWeekday(raw: unknown) {
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

/** Shared record normalization (Daily Timetable + Rooms). */
export function normalizeLessonRecords(raw: unknown): YearLessonRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item as Record<string, unknown>;
      const weekday = normalizeWeekday(o.weekday ?? o.week_day ?? o.weekDay);
      const room = String(o.room ?? o.classroom ?? o.room_name ?? "").trim();
      const time = String(o.time ?? o.lesson_time ?? "").trim();
      const effectiveDate =
        typeof o.effectiveDate === "string"
          ? o.effectiveDate
          : typeof o.effective_date === "string"
            ? o.effective_date
            : undefined;
      const createdAtRaw = o.createdAt ?? o.created_at ?? 0;
      return {
        id: typeof o.id === "string" ? o.id : undefined,
        effectiveDate,
        weekday,
        time,
        room,
        tutor: typeof o.tutor === "string" ? o.tutor : undefined,
        lessonSummary: typeof o.lessonSummary === "string" ? o.lessonSummary : undefined,
        createdAt: Number(createdAtRaw) || 0,
      } as YearLessonRecord;
    })
    .filter((r) => r.weekday && r.room);
}

function parseYearLessonStateRow(row: Record<string, unknown>): YearLessonState {
  const parsed = parseLessonYearStateDbRow(row);
  return {
    attendance: parsed.attendance,
    hiddenDates: parsed.hiddenDates,
    overrides: parsed.overrides as YearLessonState["overrides"],
    rescheduleEntries: parsed.rescheduleEntries as YearLessonState["rescheduleEntries"],
    extraEntries: parsed.extraEntries as YearLessonState["extraEntries"],
  };
}

async function loadYearStatesForStudentIds(
  studentIds: string[],
  year: number,
  supabase: SupabaseClient,
): Promise<Record<string, YearLessonState>> {
  const stateById: Record<string, YearLessonState> = {};
  for (const id of studentIds) {
    stateById[id] = {
      attendance: {},
      hiddenDates: {},
      overrides: {},
      rescheduleEntries: [],
      extraEntries: [],
    };
  }
  if (!studentIds.length) return stateById;

  const { data: stateRows, error: stateErr } = await fetchRowsInChunks({
    ids: studentIds,
    concurrency: 8,
    query: (chunk) =>
      supabase
        .from("student_lessons_year_state")
        .select("student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
        .eq("year", year)
        .in("student_id", chunk),
  });

  if (stateErr) {
    throw new Error(stateErr);
  }

  for (const row of stateRows ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    stateById[sid] = parseYearLessonStateRow(row as Record<string, unknown>);
  }

  const needLegacy = studentIdsNeedingLegacyStateFallback(studentIds, stateById, year);
  if (needLegacy.length) {
    const { data: legacyRows, error: legacyErr } = await fetchRowsInChunks({
      ids: needLegacy,
      concurrency: 8,
      query: (chunk) =>
        supabase.from("student_lessons_2026_state").select(LEGACY_2026_STATE_SELECT).in("student_id", chunk),
    });
    if (legacyErr) {
      throw new Error(legacyErr);
    }
    const legacyStates = parseLegacy2026StateRows((legacyRows ?? []) as Array<Record<string, unknown>>);
    return mergeYearStatesBatchWithLegacyFallback(studentIds, year, stateById, legacyStates) as Record<
      string,
      YearLessonState
    >;
  }

  return stateById;
}

type ScheduleStudentsCachePayload = {
  students: ScheduleStudentRow[];
  inactivePeriodsById: Record<string, StudentInactivePeriod[]>;
};

const loadScheduleStudentsContextCached = unstable_cache(
  async (): Promise<ScheduleStudentsCachePayload> => {
    const supabase = getSupabaseAdmin();
    const [{ data: students, error: stErr }, { data: periodRows, error: periodErr }] = await Promise.all([
      supabase
        .from("students")
        .select("id, name_zh, name_en, nickname_en, grade, school, textbook_publisher")
        .order("id"),
      supabase.from("student_visibility_periods").select("student_id, start_date, end_date, note"),
    ]);

    if (stErr) throw new Error(stErr.message);
    if (periodErr) throw new Error(periodErr.message);

    return {
      students: (students ?? []) as ScheduleStudentRow[],
      inactivePeriodsById: buildStudentInactivePeriodsById(periodRows ?? []),
    };
  },
  ["schedule-students-context-v3"],
  { revalidate: 300, tags: SHARED_SCHEDULE_CACHE_TAGS },
);

export async function loadScheduleStudentsForYear(year: number): Promise<ScheduleStudentsContext> {
  const { students, inactivePeriodsById: periodsById } = await loadScheduleStudentsContextCached();
  const activeStudents = filterStudentsWithAnyActivityInYear(students, periodsById, year);
  const inactivePeriodsById = new Map<string, StudentInactivePeriod[]>();

  for (const st of activeStudents) {
    // Apply F6 summer hide only if they were F6 during that summer (not after Sept promotion).
    inactivePeriodsById.set(
      st.id,
      withAutoF6InactivePeriod({
        periods: periodsById[st.id] ?? [],
        studentId: st.id,
        grade: inferGradeOnDate(st.grade ?? "", `${year}-07-15`),
        year,
      }),
    );
  }

  return { activeStudents, inactivePeriodsById };
}

const loadYearScheduleDataCached = unstable_cache(
  async (year: number): Promise<YearScheduleData> => {
    const supabase = getSupabaseAdmin();
    const { activeStudents } = await loadScheduleStudentsForYear(year);
    const ids = studentIdsOf(activeStudents);
    if (!ids.length) {
      return { normalizedRecordsById: {}, stateById: {} };
    }

    const [{ data: recRows, error: recErr }, stateById] = await Promise.all([
      fetchRowsInChunks({
        ids,
        concurrency: 8,
        query: (chunk) =>
          supabase.from("student_lesson_records").select("student_id, records").in("student_id", chunk),
      }),
      loadYearStatesForStudentIds(ids, year, supabase),
    ]);

    if (recErr) {
      throw new Error(recErr);
    }

    const normalizedRecordsById: Record<string, YearLessonRecord[]> = {};
    for (const row of recRows ?? []) {
      const sid = String((row as { student_id?: string }).student_id ?? "");
      if (!sid) continue;
      normalizedRecordsById[sid] = normalizeLessonRecords((row as { records?: unknown }).records);
    }

    return { normalizedRecordsById, stateById };
  },
  ["year-schedule-data-v1"],
  { revalidate: 120, tags: SHARED_SCHEDULE_CACHE_TAGS },
);

/** Cached year-wide lesson records + states (shared by Daily Timetable and Rooms). */
export async function loadYearScheduleData(year: number): Promise<YearScheduleData> {
  return loadYearScheduleDataCached(year);
}
