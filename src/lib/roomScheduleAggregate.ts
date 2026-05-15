import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { SCHEDULE_CACHE_TAG_AGGREGATES } from "@/lib/scheduleCacheTags";
import { fetchClassroomScheduleLabel } from "@/lib/classroomsRegistry";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isInactiveTutorName } from "@/lib/tutorVisibility";
import { fetchInactiveTutorNames } from "@/lib/tutorVisibilityCore";
import { isScheduleAttendanceMarked } from "@/lib/lessonScheduleVersions";
import {
  buildYearScheduleRowsForMonth,
  formatDateSlash,
  sortAggregatedRoomRows,
  weekdayCnParen,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";

const PERF_LOG_ENABLED = process.env.ENABLE_PERF_LOGS === "1";

export type RoomScheduleRow = {
  rowKey: string;
  studentId: string;
  studentName: string;
  grade: string;
  attendanceKey: string;
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
function hasRoomScheduleCandidate(
  records: YearLessonRecord[],
  state: YearLessonState,
  roomLabel: string,
): boolean {
  const target = roomLabel.trim();
  if (!target) return false;
  for (const r of records) {
    if (String(r.room ?? "").trim() === target) return true;
  }
  for (const ov of Object.values(state.overrides)) {
    if (String(ov?.room ?? "").trim() === target) return true;
  }
  for (const e of state.extraEntries) {
    if (String(e.room ?? "").trim() === target) return true;
  }
  for (const e of state.rescheduleEntries) {
    if (String(e.room ?? "").trim() === target) return true;
  }
  return false;
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

  const loadLegacy =
    year === 2026
      ? supabase
          .from("student_lessons_2026_state")
          .select(stateSelect)
          .in("student_id", studentIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> });

  const [legacyResult, yearResult] = await Promise.all([
    loadLegacy,
    supabase
      .from("student_lessons_year_state")
      .select(stateSelect)
      .eq("year", year)
      .in("student_id", studentIds),
  ]);

  type StateRow = Parameters<typeof dbRowToState>[0];
  for (const row of (legacyResult.data ?? []) as StateRow[]) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (sid) map.set(sid, dbRowToState(row));
  }
  for (const row of (yearResult.data ?? []) as StateRow[]) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (sid) map.set(sid, dbRowToState(row));
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
  inactiveEffectiveById: Map<string, string>;
};

type SerializableScheduleBundle = {
  students: ScheduleStudentRow[];
  recEntries: Array<[string, unknown]>;
  stateEntries: Array<[string, YearLessonState]>;
  inactiveEntries: Array<[string, string]>;
};

function serializeScheduleBundle(bundle: StudentsScheduleBundle): SerializableScheduleBundle {
  return {
    students: bundle.students,
    recEntries: [...bundle.recMap.entries()],
    stateEntries: [...bundle.stateMap.entries()],
    inactiveEntries: [...bundle.inactiveEffectiveById.entries()],
  };
}

function deserializeScheduleBundle(serialized: SerializableScheduleBundle): StudentsScheduleBundle {
  return {
    students: serialized.students,
    recMap: new Map(serialized.recEntries),
    stateMap: new Map(serialized.stateEntries),
    inactiveEffectiveById: new Map(serialized.inactiveEntries),
  };
}

async function loadStudentsScheduleBundleUncached(year: number): Promise<{
  bundle: StudentsScheduleBundle | null;
  error: string | null;
}> {
  const supabase = getSupabaseAdmin();
  const { data: students, error: stErr } = await supabase
    .from("students")
    .select("id, name_zh, name_en, nickname_en, grade, school, textbook_publisher")
    .order("id");

  if (stErr) {
    return { bundle: null, error: stErr.message };
  }

  if (!students?.length) {
    return {
      bundle: {
        students: [],
        recMap: new Map(),
        stateMap: new Map(),
        inactiveEffectiveById: new Map(),
      },
      error: null,
    };
  }

  const ids = students.map((s) => s.id);
  const [{ data: visibilityRows }, { data: recRows, error: recErr }, stateMap] = await Promise.all([
    supabase.from("student_visibility_modes").select("student_id, mode, effective_date").in("student_id", ids),
    supabase.from("student_lesson_records").select("student_id, records").in("student_id", ids),
    loadStatesForYear(ids, year, supabase),
  ]);

  if (recErr) {
    return { bundle: null, error: recErr.message };
  }

  const manualInactiveEffectiveById = new Map<string, string>();
  for (const row of visibilityRows ?? []) {
    const mode = String((row as { mode?: string }).mode ?? "active").toLowerCase();
    if (mode !== "inactive") continue;
    const sid = String((row as { student_id?: string }).student_id ?? "");
    const eff = String((row as { effective_date?: string }).effective_date ?? "");
    if (sid && eff) manualInactiveEffectiveById.set(sid, eff);
  }
  const inactiveEffectiveById = new Map<string, string>();
  for (const s of students as ScheduleStudentRow[]) {
    const sid = String(s.id ?? "");
    if (!sid) continue;
    const eff = resolveStudentInactiveEffectiveDate({
      grade: s.grade,
      manualInactiveEffective: manualInactiveEffectiveById.get(sid) ?? null,
      year,
    });
    if (eff) inactiveEffectiveById.set(sid, eff);
  }

  const recMap = new Map<string, unknown>();
  for (const r of recRows ?? []) {
    recMap.set(r.student_id, r.records);
  }

  return {
    bundle: {
      students: students as ScheduleStudentRow[],
      recMap,
      stateMap,
      inactiveEffectiveById,
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
  ["students-schedule-bundle-v1"],
  { revalidate: 45, tags: [SCHEDULE_CACHE_TAG_AGGREGATES] },
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
        inactiveEffectiveById: new Map(),
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

  const { bundle, error } = await loadStudentsScheduleBundle(year);
  const perfDbElapsedMs = PERF_LOG_ENABLED ? Date.now() - perfDbStartedAt : 0;
  if (error) {
    return { roomLabel, rows: [], loadError: error };
  }
  if (!bundle || bundle.students.length === 0) {
    return { roomLabel, rows: [], loadError: null };
  }

  const { students, recMap, stateMap, inactiveEffectiveById } = bundle;
  const normalizedRecordsById = new Map<string, YearLessonRecord[]>();
  const roomCandidateStudents: ScheduleStudentRow[] = [];
  for (const st of students) {
    const records = normalizeRecords(recMap.get(st.id));
    normalizedRecordsById.set(st.id, records);
    const state = stateMap.get(st.id) ?? emptyState();
    if (hasRoomScheduleCandidate(records, state, roomLabel)) {
      roomCandidateStudents.push(st);
    }
  }
  const startIso = options?.startIso?.trim() || "";
  const endIso = options?.endIso?.trim() || "";
  const rangeActive = Boolean(startIso && endIso);
  const monthsToLoad = (() => {
    if (!rangeActive) return [month];
    const sm = Number(startIso.slice(5, 7));
    const em = Number(endIso.slice(5, 7));
    if (!Number.isFinite(sm) || !Number.isFinite(em)) return [month];
    if (sm === em) return [Math.min(12, Math.max(1, sm))];
    const set = new Set<number>([
      Math.min(12, Math.max(1, sm)),
      Math.min(12, Math.max(1, em)),
    ]);
    return Array.from(set).sort((a, b) => a - b);
  })();
  const out: RoomScheduleRow[] = [];

  for (const st of roomCandidateStudents) {
    const records = normalizedRecordsById.get(st.id) ?? [];
    const state = stateMap.get(st.id) ?? emptyState();
    const monthRows = monthsToLoad.flatMap((m) => buildYearScheduleRowsForMonth(records, state, year, m));
    const filtered = monthRows
      .filter((r) => r.lessonType !== "取消" && r.room.trim() === roomLabel)
      .filter((r) => (!rangeActive ? true : r.date >= startIso && r.date <= endIso));
    const inactiveEffective = inactiveEffectiveById.get(st.id);
    const visibilityFiltered = inactiveEffective
      ? filtered.filter((r) => r.date < inactiveEffective)
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
      `[perf] fetchRoomScheduleAggregate slug=${slug} room=${roomLabel} y=${year} m=${month} students=${students.length} candidates=${roomCandidateStudents.length} rows=${sortedRows.length} dbMs=${perfDbElapsedMs} computeMs=${computeMs} elapsedMs=${elapsedMs}`,
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
    ["room-schedule-aggregate-v1", slugKey, String(year), String(month), startIso, endIso],
    { revalidate: 45, tags: [SCHEDULE_CACHE_TAG_AGGREGATES] },
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

  const { students, recMap, stateMap, inactiveEffectiveById } = bundle;
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
    let filtered = buildYearScheduleRowsForMonth(records, state, year, month).filter(
      (r) => r.lessonType !== "取消",
    );
    const inactiveEffective = inactiveEffectiveById.get(st.id);
    if (inactiveEffective) {
      filtered = filtered.filter((r) => r.date < inactiveEffective);
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
    { revalidate: 45, tags: [SCHEDULE_CACHE_TAG_AGGREGATES] },
  )();
}
