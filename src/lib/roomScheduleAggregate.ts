import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { SCHEDULE_CACHE_TAG_AGGREGATES } from "@/lib/scheduleCacheTags";
import { fetchClassroomScheduleLabel } from "@/lib/classroomsRegistry";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { filterStudentsWithAnyActivityInYear, studentIdsOf } from "@/lib/activeStudentIds";
import {
  buildStudentInactivePeriodsById,
  isStudentInactiveOnDateFromPeriods,
  withAutoF6InactivePeriod,
  type StudentInactivePeriod,
} from "@/lib/studentVisibility";
import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";
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
import {
  isEmptyLessonYearState,
  LEGACY_2026_STATE_SELECT,
  LEGACY_LESSON_STATE_YEAR,
} from "@/lib/lessonYearStateLegacy";
import { scheduleRoomsMatch } from "@/lib/dayTimetableShared";
import { monthsToLoadForScheduleRange } from "@/lib/roomScheduleMonths";
import { loadRoomSlotTutorRulesServer } from "@/lib/roomSlotTutorRules";
import {
  hasRoomScheduleCandidateFromRecords,
  hasRoomScheduleCandidateFromStateSignals,
  isEmptyRoomStateSignals,
  type RoomStateSignals,
} from "@/lib/roomScheduleCandidate";

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

function coerceBooleanRecord(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === true || v === false) out[k] = v;
  }
  return out;
}

function coerceOverrides(raw: unknown): YearLessonState["overrides"] {
  if (!raw || typeof raw !== "object") return {};
  const out: YearLessonState["overrides"] = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const entry: {
      time?: string;
      room?: string;
      tutor?: string;
      lessonSummary?: string;
    } = {};
    if (typeof o.time === "string") entry.time = o.time;
    if (typeof o.room === "string") entry.room = o.room;
    if (typeof o.tutor === "string") entry.tutor = o.tutor;
    if (typeof o.lessonSummary === "string") entry.lessonSummary = o.lessonSummary;
    if (Object.keys(entry).length) out[k] = entry;
  }
  return out;
}

function coerceReschedule(raw: unknown): YearLessonState["rescheduleEntries"] {
  if (!Array.isArray(raw)) return [];
  const out: YearLessonState["rescheduleEntries"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "");
    const fromDate = String(o.fromDate ?? "");
    const toDate = String(o.toDate ?? "");
    const pending = o.pending === true || !toDate;
    if (!id || !fromDate) continue;
    if (!pending && !toDate) continue;
    out.push({
      id,
      fromDate,
      toDate,
      time: String(o.time ?? ""),
      room: String(o.room ?? ""),
      ...(pending ? { pending: true as const } : {}),
    });
  }
  return out;
}

function coerceExtra(raw: unknown): YearLessonState["extraEntries"] {
  if (!Array.isArray(raw)) return [];
  const out: YearLessonState["extraEntries"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "");
    const date = String(o.date ?? "");
    if (!id || !date) continue;
    out.push({
      id,
      date,
      time: String(o.time ?? ""),
      room: String(o.room ?? ""),
    });
  }
  return out;
}

function dbRowToState(row: {
  attendance: unknown;
  hidden_dates: unknown;
  overrides: unknown;
  reschedule_entries: unknown;
  extra_entries: unknown;
}): YearLessonState {
  return {
    attendance: coerceBooleanRecord(row.attendance),
    hiddenDates: coerceBooleanRecord(row.hidden_dates),
    overrides: coerceOverrides(row.overrides),
    rescheduleEntries: coerceReschedule(row.reschedule_entries),
    extraEntries: coerceExtra(row.extra_entries),
  };
}

function normalizeRecords(raw: unknown): YearLessonRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: YearLessonRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const weekday = String(o.weekday ?? "");
    const room = String(o.room ?? "");
    if (!weekday || !room) continue;
    const createdAt =
      typeof o.createdAt === "number"
        ? o.createdAt
        : Number(o.createdAt) > 0
          ? Number(o.createdAt)
          : Date.now();
    out.push({
      id: typeof o.id === "string" ? o.id : undefined,
      effectiveDate: typeof o.effectiveDate === "string" ? o.effectiveDate : undefined,
      weekday,
      time: String(o.time ?? ""),
      room,
      tutor: o.tutor != null ? String(o.tutor) : undefined,
      lessonSummary: o.lessonSummary != null ? String(o.lessonSummary) : undefined,
      createdAt,
    });
  }
  return out;
}

function hasTutorNameCandidate(
  records: YearLessonRecord[],
  state: YearLessonState,
  nameSet: Set<string>,
): boolean {
  for (const r of records) {
    const t = String(r.tutor ?? "").trim();
    if (t && nameSet.has(t)) return true;
  }
  for (const ov of Object.values(state.overrides)) {
    const t = String(ov?.tutor ?? "").trim();
    if (t && nameSet.has(t)) return true;
  }
  return false;
}

/** 課表記錄／補堂／加堂／覆寫是否可能出現在目標房間（避免對全體學生展開整月）。 */
function monthsToLoadForRange(startIso: string, endIso: string, fallbackMonth: number): number[] {
  return monthsToLoadForScheduleRange(startIso, endIso, fallbackMonth);
}

function emptyStateSignals(): RoomStateSignals {
  return { overrides: {}, rescheduleEntries: [], extraEntries: [] };
}

function dbRowToStateSignals(row: {
  overrides: unknown;
  reschedule_entries: unknown;
  extra_entries: unknown;
}): RoomStateSignals {
  const full = dbRowToState({
    attendance: {},
    hidden_dates: {},
    overrides: row.overrides,
    reschedule_entries: row.reschedule_entries,
    extra_entries: row.extra_entries,
  });
  return {
    overrides: full.overrides,
    rescheduleEntries: full.rescheduleEntries,
    extraEntries: full.extraEntries,
  };
}

async function loadStateRoomSignalsForYear(
  studentIds: string[],
  year: number,
  supabase: SupabaseClient,
): Promise<Map<string, RoomStateSignals>> {
  const map = new Map<string, RoomStateSignals>();
  for (const id of studentIds) {
    map.set(id, emptyStateSignals());
  }
  if (!studentIds.length) return map;

  const signalSelect = "student_id, overrides, reschedule_entries, extra_entries" as const;
  const yearResult = await fetchRowsInChunks({
    ids: studentIds,
    query: (chunk) =>
      supabase
        .from("student_lessons_year_state")
        .select(signalSelect)
        .eq("year", year)
        .in("student_id", chunk),
  });

  if (yearResult.error) return map;

  type SignalRow = Parameters<typeof dbRowToStateSignals>[0];
  for (const row of yearResult.data as SignalRow[]) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (sid) map.set(sid, dbRowToStateSignals(row));
  }

  if (year === LEGACY_LESSON_STATE_YEAR) {
    const needLegacy = studentIds.filter((id) => isEmptyRoomStateSignals(map.get(id)));
    if (needLegacy.length) {
      const legacyResult = await fetchRowsInChunks({
        ids: needLegacy,
        query: (chunk) =>
          supabase
            .from("student_lessons_2026_state")
            .select("student_id, overrides, reschedule_entries, extra_entries")
            .in("student_id", chunk),
      });
      if (!legacyResult.error) {
        for (const row of legacyResult.data as SignalRow[]) {
          const sid = String((row as { student_id?: string }).student_id ?? "");
          if (!sid) continue;
          const legacy = dbRowToStateSignals(row);
          if (!isEmptyRoomStateSignals(legacy)) map.set(sid, legacy);
        }
      }
    }
  }

  return map;
}

async function loadActiveStudentsScheduleContext(year: number): Promise<{
  supabase: SupabaseClient;
  activeStudents: ScheduleStudentRow[];
  inactivePeriodsById: Map<string, StudentInactivePeriod[]>;
  error: string | null;
}> {
  const supabase = getSupabaseAdmin();
  const { data: students, error: stErr } = await supabase
    .from("students")
    .select("id, name_zh, name_en, nickname_en, grade, school, textbook_publisher")
    .order("id");

  if (stErr) {
    return {
      supabase,
      activeStudents: [],
      inactivePeriodsById: new Map(),
      error: stErr.message,
    };
  }

  if (!students?.length) {
    return {
      supabase,
      activeStudents: [],
      inactivePeriodsById: new Map(),
      error: null,
    };
  }

  const allIds = students.map((s) => String(s.id ?? "")).filter(Boolean);
  const { data: periodRows, error: periodErr } = await fetchRowsInChunks({
    ids: allIds,
    query: (chunk) =>
      supabase
        .from("student_visibility_periods")
        .select("student_id, start_date, end_date, note")
        .in("student_id", chunk),
  });
  if (periodErr) {
    return { supabase, activeStudents: [], inactivePeriodsById: new Map(), error: periodErr };
  }

  const periodsById = buildStudentInactivePeriodsById(periodRows ?? []);

  const activeStudents = filterStudentsWithAnyActivityInYear(
    students as ScheduleStudentRow[],
    periodsById,
    year,
  );

  const inactivePeriodsById = new Map<string, StudentInactivePeriod[]>();
  for (const s of activeStudents) {
    const sid = String(s.id ?? "");
    if (!sid) continue;
    inactivePeriodsById.set(
      sid,
      withAutoF6InactivePeriod({
        periods: periodsById[sid] ?? [],
        studentId: sid,
        grade: s.grade,
        year,
      }),
    );
  }

  return { supabase, activeStudents, inactivePeriodsById, error: null };
}

async function loadLessonRecordsMap(
  studentIds: string[],
  supabase: SupabaseClient,
): Promise<{ recMap: Map<string, unknown>; error: string | null }> {
  const recMap = new Map<string, unknown>();
  if (!studentIds.length) return { recMap, error: null };

  const { data: recRows, error: recErr } = await fetchRowsInChunks({
    ids: studentIds,
    query: (chunk) =>
      supabase.from("student_lesson_records").select("student_id, records").in("student_id", chunk),
  });
  if (recErr) return { recMap, error: recErr };

  for (const r of recRows ?? []) {
    recMap.set(String((r as { student_id?: string }).student_id ?? ""), (r as { records?: unknown }).records);
  }
  return { recMap, error: null };
}

async function loadRoomScheduleBundleUncached(
  year: number,
  roomLabel: string,
): Promise<{ bundle: StudentsScheduleBundle | null; error: string | null; stats?: { active: number; stateLoads: number } }> {
  const ctx = await loadActiveStudentsScheduleContext(year);
  if (ctx.error) return { bundle: null, error: ctx.error };
  if (!ctx.activeStudents.length) {
    return {
      bundle: {
        students: [],
        recMap: new Map(),
        stateMap: new Map(),
        inactivePeriodsById: ctx.inactivePeriodsById,
      },
      error: null,
      stats: { active: 0, stateLoads: 0 },
    };
  }

  const ids = studentIdsOf(ctx.activeStudents);
  const { recMap, error: recErr } = await loadLessonRecordsMap(ids, ctx.supabase);
  if (recErr) return { bundle: null, error: recErr };

  const recordCandidateIds = new Set<string>();
  const needsStateSignalScan: string[] = [];
  for (const st of ctx.activeStudents) {
    const sid = String(st.id ?? "");
    if (!sid) continue;
    const records = normalizeRecords(recMap.get(sid));
    if (hasRoomScheduleCandidateFromRecords(records, roomLabel)) {
      recordCandidateIds.add(sid);
    } else {
      needsStateSignalScan.push(sid);
    }
  }

  const finalCandidateIds = new Set(recordCandidateIds);
  if (needsStateSignalScan.length) {
    const signalMap = await loadStateRoomSignalsForYear(needsStateSignalScan, year, ctx.supabase);
    for (const sid of needsStateSignalScan) {
      const signals = signalMap.get(sid) ?? emptyStateSignals();
      if (hasRoomScheduleCandidateFromStateSignals(signals, roomLabel)) {
        finalCandidateIds.add(sid);
      }
    }
  }

  const candidateIdList = [...finalCandidateIds];
  const stateMap = await loadStatesForYear(candidateIdList, year, ctx.supabase);

  const candidateStudents = ctx.activeStudents.filter((s) => finalCandidateIds.has(String(s.id ?? "")));
  const candidateRecMap = new Map<string, unknown>();
  for (const sid of candidateIdList) {
    if (recMap.has(sid)) candidateRecMap.set(sid, recMap.get(sid));
  }

  const candidateInactive = new Map<string, StudentInactivePeriod[]>();
  for (const sid of candidateIdList) {
    const periods = ctx.inactivePeriodsById.get(sid);
    if (periods?.length) candidateInactive.set(sid, periods);
  }

  return {
    bundle: {
      students: candidateStudents,
      recMap: candidateRecMap,
      stateMap,
        inactivePeriodsById: candidateInactive,
    },
    error: null,
    stats: { active: ids.length, stateLoads: candidateIdList.length },
  };
}

async function loadStatesForYear(
  studentIds: string[],
  year: number,
  supabase: SupabaseClient,
): Promise<Map<string, YearLessonState>> {
  const map = new Map<string, YearLessonState>();
  for (const id of studentIds) {
    map.set(id, emptyState());
  }
  if (studentIds.length === 0) return map;

  const stateSelect =
    "student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries" as const;

  const yearResult = await fetchRowsInChunks({
    ids: studentIds,
    query: (chunk) =>
      supabase
        .from("student_lessons_year_state")
        .select(stateSelect)
        .eq("year", year)
        .in("student_id", chunk),
  });

  if (yearResult.error) {
    return map;
  }

  type StateRow = Parameters<typeof dbRowToState>[0];
  for (const row of yearResult.data as StateRow[]) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (sid) map.set(sid, dbRowToState(row));
  }

  if (year === LEGACY_LESSON_STATE_YEAR) {
    const needLegacy = studentIds.filter((id) => isEmptyLessonYearState(map.get(id) ?? emptyState()));
    if (needLegacy.length) {
      const legacyResult = await fetchRowsInChunks({
        ids: needLegacy,
        query: (chunk) =>
          supabase.from("student_lessons_2026_state").select(LEGACY_2026_STATE_SELECT).in("student_id", chunk),
      });
      if (!legacyResult.error) {
        for (const row of legacyResult.data as StateRow[]) {
          const sid = String((row as { student_id?: string }).student_id ?? "");
          if (!sid) continue;
          const legacy = dbRowToState(row);
          if (!isEmptyLessonYearState(legacy)) map.set(sid, legacy);
        }
      }
    }
  }

  return map;
}

type ScheduleStudentRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  nickname_en: string | null;
  grade: string | null;
  school: string | null;
  textbook_publisher: string | null;
};

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
  const ctx = await loadActiveStudentsScheduleContext(year);
  if (ctx.error) return { bundle: null, error: ctx.error };

  const ids = studentIdsOf(ctx.activeStudents);
  const [{ recMap, error: recErr }, stateMap] = await Promise.all([
    loadLessonRecordsMap(ids, ctx.supabase),
    loadStatesForYear(ids, year, ctx.supabase),
  ]);

  if (recErr) return { bundle: null, error: recErr };

  return {
    bundle: {
      students: ctx.activeStudents,
      recMap,
      stateMap,
      inactivePeriodsById: ctx.inactivePeriodsById,
    },
    error: null,
  };
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

  const { bundle, error, stats } = await loadRoomScheduleBundleUncached(year, roomLabel);
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
    normalizedRecordsById.set(st.id, normalizeRecords(recMap.get(st.id)));
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
      .filter((r) => r.lessonType !== "取消" && scheduleRoomsMatch(r.room, roomLabel))
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
      ? filtered.filter((r) => !isStudentInactiveOnDateFromPeriods({ periods, dateIso: r.date }))
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
  const roomSlotTutorRules = await loadRoomSlotTutorRulesServer(getSupabaseAdmin());
  const out: TutorMonthLessonRow[] = [];
  const normalizedRecordsById = new Map<string, YearLessonRecord[]>();
  const hasTutorCandidateById = new Map<string, boolean>();
  for (const st of students) {
    const records = normalizeRecords(recMap.get(st.id));
    normalizedRecordsById.set(st.id, records);
    const state = stateMap.get(st.id) ?? emptyState();
    hasTutorCandidateById.set(st.id, hasTutorNameCandidate(records, state, nameSet));
  }

  for (const st of students) {
    const records = normalizedRecordsById.get(st.id) ?? [];
    const state = stateMap.get(st.id) ?? emptyState();
    if (!hasTutorCandidateById.get(st.id)) continue;
    let filtered = buildYearScheduleRowsForMonth(records, state, year, month, { roomSlotTutorRules }).filter(
      (r) => r.lessonType !== "取消",
    );
    const periods = inactivePeriodsById.get(st.id) ?? [];
    if (periods.length) {
      filtered = filtered.filter((r) => !isStudentInactiveOnDateFromPeriods({ periods, dateIso: r.date }));
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
