import { unstable_cache } from "next/cache";
import { SCHEDULE_CACHE_TAG_AGGREGATES } from "@/lib/scheduleCacheTags";
import { fetchClassroomScheduleLabel } from "@/lib/classroomsRegistry";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import {
  shouldHideScheduledLessonForInactivePeriod,
  type StudentInactivePeriod,
} from "@/lib/studentVisibility";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isInactiveTutorName } from "@/lib/tutorVisibility";
import { fetchInactiveTutorNames } from "@/lib/tutorVisibilityCore";
import { isScheduleAttendanceMarked } from "@/lib/lessonScheduleVersions";
import {
  isOnOrAfterLessonSystemStart,
  normalizeCalendarDateIso,
} from "@/lib/lessonSystemStart";
import {
  buildYearScheduleRowsForMonth,
  formatDateSlash,
  sortAggregatedRoomRows,
  weekdayCnParen,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";
import { scheduleRoomsMatch } from "@/lib/dayTimetableShared";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import { monthsToLoadForScheduleRange } from "@/lib/roomScheduleMonths";
import { loadRoomSlotTutorRulesServer } from "@/lib/roomSlotTutorRules";
import { hasTutorNameCandidate } from "@/lib/tutorMonthCandidate";
import { hasRoomScheduleCandidate } from "@/lib/roomScheduleCandidate";
import {
  loadScheduleStudentsForYear,
  loadYearScheduleData,
  normalizeLessonRecords,
  type ScheduleStudentRow,
} from "@/lib/yearScheduleData.server";

const PERF_LOG_ENABLED = process.env.ENABLE_PERF_LOGS === "1";

export type RoomScheduleRow = {
  rowKey: string;
  studentId: string;
  studentName: string;
  grade: string;
  attendanceKey: string;
  scheduleRuleId?: string;
  attended: boolean;
  dateIso: string;
  dateDisplay: string;
  weekdayDisplay: string;
  time: string;
  room: string;
  tutor: string;
  note: string;
  school: string;
  textbookPublisher: string;
  /** 對應試算表「主頁 E2」；目前資料庫無獨立欄位，保留空白 */
  profileExtra: string;
  lessonType: string;
  sortTime: string;
};

function emptyState(): YearLessonState {
  return {
    attendance: {},
    hiddenDates: {},
    overrides: {},
    rescheduleEntries: [],
    extraEntries: [],
  };
}

function recordsFromBundleEntry(raw: unknown): YearLessonRecord[] {
  if (Array.isArray(raw)) return raw as YearLessonRecord[];
  return normalizeLessonRecords(raw);
}

function monthsToLoadForRange(startIso: string, endIso: string, fallbackMonth: number): number[] {
  return monthsToLoadForScheduleRange(startIso, endIso, fallbackMonth);
}

/** Uses shared year schedule cache; filters to room candidates in memory (no extra DB on cache hit). */
async function loadRoomScheduleBundleFromSharedCache(
  year: number,
  roomLabel: string,
): Promise<{ bundle: StudentsScheduleBundle | null; error: string | null; stats?: { active: number; stateLoads: number } }> {
  try {
    const [studentsCtx, yearSchedule] = await Promise.all([
      loadScheduleStudentsForYear(year),
      loadYearScheduleData(year),
    ]);

    const candidateIds = new Set<string>();
    for (const st of studentsCtx.activeStudents) {
      const records = yearSchedule.normalizedRecordsById[st.id] ?? [];
      const state = yearSchedule.stateById[st.id] ?? emptyState();
      if (hasRoomScheduleCandidate(records, state, roomLabel)) {
        candidateIds.add(st.id);
      }
    }

    const candidateStudents = studentsCtx.activeStudents.filter((s) => candidateIds.has(s.id));
    const recMap = new Map<string, unknown>();
    const stateMap = new Map<string, YearLessonState>();
    const candidateInactive = new Map<string, StudentInactivePeriod[]>();

    for (const sid of candidateIds) {
      recMap.set(sid, yearSchedule.normalizedRecordsById[sid] ?? []);
      stateMap.set(sid, yearSchedule.stateById[sid] ?? emptyState());
      const periods = studentsCtx.inactivePeriodsById.get(sid);
      if (periods?.length) candidateInactive.set(sid, periods);
    }

    return {
      bundle: {
        students: candidateStudents,
        recMap,
        stateMap,
        inactivePeriodsById: candidateInactive,
      },
      error: null,
      stats: { active: studentsCtx.activeStudents.length, stateLoads: candidateIds.size },
    };
  } catch (error) {
    return {
      bundle: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

type StudentsScheduleBundle = {
  students: ScheduleStudentRow[];
  recMap: Map<string, unknown>;
  stateMap: Map<string, YearLessonState>;
  inactivePeriodsById: Map<string, StudentInactivePeriod[]>;
};

type SerializableScheduleBundle = {
  students: ScheduleStudentRow[];
  recEntries: Array<[string, unknown]>;
  stateEntries: Array<[string, YearLessonState]>;
  inactiveEntries: Array<[string, StudentInactivePeriod[]]>;
};

function serializeScheduleBundle(bundle: StudentsScheduleBundle): SerializableScheduleBundle {
  return {
    students: bundle.students,
    recEntries: [...bundle.recMap.entries()],
    stateEntries: [...bundle.stateMap.entries()],
    inactiveEntries: [...bundle.inactivePeriodsById.entries()],
  };
}

function deserializeScheduleBundle(serialized: SerializableScheduleBundle): StudentsScheduleBundle {
  return {
    students: serialized.students,
    recMap: new Map(serialized.recEntries),
    stateMap: new Map(serialized.stateEntries),
    inactivePeriodsById: new Map(serialized.inactiveEntries),
  };
}

async function loadStudentsScheduleBundleUncached(year: number): Promise<{
  bundle: StudentsScheduleBundle | null;
  error: string | null;
}> {
  try {
    const [studentsCtx, yearSchedule] = await Promise.all([
      loadScheduleStudentsForYear(year),
      loadYearScheduleData(year),
    ]);

    const recMap = new Map<string, unknown>();
    const stateMap = new Map<string, YearLessonState>();
    for (const st of studentsCtx.activeStudents) {
      recMap.set(st.id, yearSchedule.normalizedRecordsById[st.id] ?? []);
      stateMap.set(st.id, yearSchedule.stateById[st.id] ?? emptyState());
    }

    return {
      bundle: {
        students: studentsCtx.activeStudents,
        recMap,
        stateMap,
        inactivePeriodsById: studentsCtx.inactivePeriodsById,
      },
      error: null,
    };
  } catch (error) {
    return {
      bundle: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const loadStudentsScheduleBundleCached = unstable_cache(
  async (year: number): Promise<{ bundle: SerializableScheduleBundle | null; error: string | null }> => {
    const result = await loadStudentsScheduleBundleUncached(year);
    if (result.error || !result.bundle) {
      return { bundle: null, error: result.error };
    }
    return { bundle: serializeScheduleBundle(result.bundle), error: null };
  },
  ["students-schedule-bundle-v2"],
  // Heavy bundle (students + records + states). Keep longer TTL; tags will bust after edits.
  { revalidate: 180, tags: [SCHEDULE_CACHE_TAG_AGGREGATES] },
);

async function loadStudentsScheduleBundle(year: number): Promise<{
  bundle: StudentsScheduleBundle | null;
  error: string | null;
}> {
  const cached = await loadStudentsScheduleBundleCached(year);
  if (cached.error) return { bundle: null, error: cached.error };
  if (!cached.bundle) {
    return {
      bundle: {
        students: [],
        recMap: new Map(),
        stateMap: new Map(),
        inactivePeriodsById: new Map(),
      },
      error: null,
    };
  }
  return { bundle: deserializeScheduleBundle(cached.bundle), error: null };
}

async function fetchRoomScheduleAggregateUncached(
  slug: string,
  year: number,
  month: number,
  options?: { startIso?: string; endIso?: string },
): Promise<{ roomLabel: string; rows: RoomScheduleRow[]; loadError: string | null }> {
  const perfStartedAt = PERF_LOG_ENABLED ? Date.now() : 0;
  const perfDbStartedAt = PERF_LOG_ENABLED ? Date.now() : 0;
  const roomLabel = await fetchClassroomScheduleLabel(slug);
  if (!roomLabel) {
    return { roomLabel: "", rows: [], loadError: null };
  }

  const { bundle, error, stats } = await loadRoomScheduleBundleFromSharedCache(year, roomLabel);
  const perfDbElapsedMs = PERF_LOG_ENABLED ? Date.now() - perfDbStartedAt : 0;
  if (error) {
    return { roomLabel, rows: [], loadError: error };
  }
  if (!bundle || bundle.students.length === 0) {
    return { roomLabel, rows: [], loadError: null };
  }

  const { students, recMap, stateMap, inactivePeriodsById } = bundle;
  const supabase = getSupabaseAdmin();
  const roomSlotTutorRules = await loadRoomSlotTutorRulesServer(supabase);
  const normalizedRecordsById = new Map<string, YearLessonRecord[]>();
  const roomCandidateStudents: ScheduleStudentRow[] = students;
  for (const st of students) {
    normalizedRecordsById.set(st.id, recordsFromBundleEntry(recMap.get(st.id)));
  }
  const startIso = options?.startIso?.trim() || "";
  const endIso = options?.endIso?.trim() || "";
  const rangeActive = Boolean(startIso && endIso);
  const monthsToLoad = rangeActive
    ? monthsToLoadForRange(startIso, endIso, month)
    : [month];
  const out: RoomScheduleRow[] = [];

  for (const st of roomCandidateStudents) {
    const records = normalizedRecordsById.get(st.id) ?? [];
    const state = stateMap.get(st.id) ?? emptyState();
    const monthRows = monthsToLoad.flatMap((m) =>
      buildYearScheduleRowsForMonth(records, state, year, m, { roomSlotTutorRules }),
    );
    const filtered = monthRows
      .filter(
        (r) =>
          r.lessonType !== "取消" &&
          r.lessonType !== PENDING_MAKEUP_TYPE_LABEL &&
          scheduleRoomsMatch(r.room, roomLabel),
      )
      .filter((r) => {
        const nd = normalizeCalendarDateIso(r.date);
        if (!nd || !isOnOrAfterLessonSystemStart(nd, year)) return false;
        if (!rangeActive) return Number(nd.slice(5, 7)) === month;
        const ns = normalizeCalendarDateIso(startIso) ?? startIso;
        const ne = normalizeCalendarDateIso(endIso) ?? endIso;
        return nd >= ns && nd <= ne;
      });
    const periods = inactivePeriodsById.get(st.id) ?? [];
    const visibilityFiltered = periods.length
      ? filtered.filter(
          (r) =>
            !shouldHideScheduledLessonForInactivePeriod({
              periods,
              dateIso: r.date,
              lessonType: r.lessonType,
            }),
        )
      : filtered;
    const name = formatStudentDisplayName(
      { id: st.id, name_zh: st.name_zh, name_en: st.name_en, nickname_en: st.nickname_en },
      "full",
    );

    for (const [idx, r] of visibilityFiltered.entries()) {
      out.push({
        rowKey: `${st.id}:${r.rowId}:${r.date}:${r.time}:${idx}`,
        studentId: st.id,
        studentName: name,
        grade: (st.grade ?? "").toString(),
        attendanceKey: r.attendanceKey,
        scheduleRuleId: r.scheduleRuleId,
        attended: isScheduleAttendanceMarked(state.attendance, {
          attendanceKey: r.attendanceKey,
          dateIso: r.date,
          lessonType: r.lessonType,
          scheduleRuleId: r.scheduleRuleId,
        }),
        dateIso: r.date,
        dateDisplay: formatDateSlash(r.date),
        weekdayDisplay: weekdayCnParen(r.date),
        time: r.time,
        room: r.room,
        tutor: r.tutorDisplay,
        note: r.noteDisplay,
        school: (st.school ?? "").toString(),
        textbookPublisher: (st.textbook_publisher ?? "").toString(),
        profileExtra: "",
        lessonType: r.lessonType,
        sortTime: r.sortTime,
      });
    }
  }

  const inactiveNames = await fetchInactiveTutorNames(getSupabaseAdmin());
  for (const r of out) {
    if (isInactiveTutorName(inactiveNames, r.tutor)) r.tutor = "";
  }

  const sortedRows = sortAggregatedRoomRows(out);
  if (PERF_LOG_ENABLED) {
    const elapsedMs = Date.now() - perfStartedAt;
    const computeMs = Math.max(0, elapsedMs - perfDbElapsedMs);
    console.info(
      `[perf] fetchRoomScheduleAggregate slug=${slug} room=${roomLabel} y=${year} m=${month} active=${stats?.active ?? students.length} stateLoads=${stats?.stateLoads ?? students.length} candidates=${roomCandidateStudents.length} rows=${sortedRows.length} dbMs=${perfDbElapsedMs} computeMs=${computeMs} elapsedMs=${elapsedMs}`,
    );
  }
  return { roomLabel, rows: sortedRows, loadError: null };
}

/** Cached full-room expand (heavy); short TTL keeps edits near-real-time while cutting repeat DB load. */
export async function fetchRoomScheduleAggregate(
  slug: string,
  year: number,
  month: number,
  options?: { startIso?: string; endIso?: string },
): Promise<{ roomLabel: string; rows: RoomScheduleRow[]; loadError: string | null }> {
  const startIso = options?.startIso?.trim() ?? "";
  const endIso = options?.endIso?.trim() ?? "";
  const slugKey = slug.trim().toLowerCase();
  return unstable_cache(
    async () => fetchRoomScheduleAggregateUncached(slug, year, month, { startIso, endIso }),
    ["room-schedule-aggregate-v3", slugKey, String(year), String(month), startIso, endIso],
    // Heavy full-room expand; longer TTL + tag busting keeps UI snappy.
    { revalidate: 180, tags: [SCHEDULE_CACHE_TAG_AGGREGATES] },
  )();
}

/** 導師月度上堂明細（與學生課表／房間課表同一套展開邏輯）；依課表上的導師顯示名稱比對 */
export type TutorMonthLessonRow = {
  rowKey: string;
  studentId: string;
  studentName: string;
  grade: string;
  dateIso: string;
  dateDisplay: string;
  weekdayDisplay: string;
  time: string;
  room: string;
  lessonType: string;
  note: string;
  attended: boolean;
  sortTime: string;
};

async function fetchTutorMonthLessonRowsUncached(
  tutorDisplayNames: string[],
  year: number,
  month: number,
): Promise<{ rows: TutorMonthLessonRow[]; loadError: string | null }> {
  const perfStartedAt = PERF_LOG_ENABLED ? Date.now() : 0;
  const perfDbStartedAt = PERF_LOG_ENABLED ? Date.now() : 0;
  const nameSet = new Set(tutorDisplayNames.map((s) => s.trim()).filter(Boolean));
  if (nameSet.size === 0) {
    return { rows: [], loadError: null };
  }

  const { bundle, error } = await loadStudentsScheduleBundle(year);
  const perfDbElapsedMs = PERF_LOG_ENABLED ? Date.now() - perfDbStartedAt : 0;
  if (error) {
    return { rows: [], loadError: error };
  }
  if (!bundle || bundle.students.length === 0) {
    return { rows: [], loadError: null };
  }

  const { students, recMap, stateMap, inactivePeriodsById } = bundle;
  const supabase = getSupabaseAdmin();
  const roomSlotTutorRules = await loadRoomSlotTutorRulesServer(supabase);
  const out: TutorMonthLessonRow[] = [];
  const normalizedRecordsById = new Map<string, YearLessonRecord[]>();
  const hasTutorCandidateById = new Map<string, boolean>();
  for (const st of students) {
    const records = recordsFromBundleEntry(recMap.get(st.id));
    normalizedRecordsById.set(st.id, records);
    const state = stateMap.get(st.id) ?? emptyState();
    hasTutorCandidateById.set(st.id, hasTutorNameCandidate(records, state, nameSet, roomSlotTutorRules));
  }

  for (const st of students) {
    const records = normalizedRecordsById.get(st.id) ?? [];
    const state = stateMap.get(st.id) ?? emptyState();
    if (!hasTutorCandidateById.get(st.id)) continue;
    let filtered = buildYearScheduleRowsForMonth(records, state, year, month, {
      roomSlotTutorRules,
    }).filter(
      (r) => r.lessonType !== "取消",
    );
    const periods = inactivePeriodsById.get(st.id) ?? [];
    if (periods.length) {
      filtered = filtered.filter(
        (r) =>
          !shouldHideScheduledLessonForInactivePeriod({
            periods,
            dateIso: r.date,
            lessonType: r.lessonType,
          }),
      );
    }
    const studentName = formatStudentDisplayName(
      { id: st.id, name_zh: st.name_zh, name_en: st.name_en, nickname_en: st.nickname_en },
      "full",
    );

    for (const r of filtered) {
      const td = r.tutorDisplay.trim();
      if (!nameSet.has(td)) continue;
      const attended = isScheduleAttendanceMarked(state.attendance, {
        attendanceKey: r.attendanceKey,
        dateIso: r.date,
        lessonType: r.lessonType,
        scheduleRuleId: r.scheduleRuleId,
      });
      if (!attended) continue;
      out.push({
        rowKey: `${st.id}:${r.rowId}`,
        studentId: st.id,
        studentName,
        grade: (st.grade ?? "").toString(),
        dateIso: r.date,
        dateDisplay: formatDateSlash(r.date),
        weekdayDisplay: weekdayCnParen(r.date),
        time: r.time,
        room: r.room,
        lessonType: r.lessonType,
        note: r.noteDisplay,
        attended: true,
        sortTime: r.sortTime,
      });
    }
  }

  const sortedRows = sortAggregatedRoomRows(out);
  if (PERF_LOG_ENABLED) {
    const elapsedMs = Date.now() - perfStartedAt;
    const computeMs = Math.max(0, elapsedMs - perfDbElapsedMs);
    console.info(
      `[perf] fetchTutorMonthLessonRows y=${year} m=${month} nameCount=${nameSet.size} students=${students.length} rows=${sortedRows.length} dbMs=${perfDbElapsedMs} computeMs=${computeMs} elapsedMs=${elapsedMs}`,
    );
  }
  return { rows: sortedRows, loadError: null };
}

export async function fetchTutorMonthLessonRows(
  tutorDisplayNames: string[],
  year: number,
  month: number,
): Promise<{ rows: TutorMonthLessonRow[]; loadError: string | null }> {
  const nameKey = [...new Set(tutorDisplayNames.map((s) => s.trim()).filter(Boolean))]
    .sort()
    .join("\0");
  if (!nameKey) return { rows: [], loadError: null };
  return unstable_cache(
    async () => fetchTutorMonthLessonRowsUncached(tutorDisplayNames, year, month),
    ["tutor-month-lessons-v1", nameKey, String(year), String(month)],
    { revalidate: 180, tags: [SCHEDULE_CACHE_TAG_AGGREGATES] },
  )();
}
