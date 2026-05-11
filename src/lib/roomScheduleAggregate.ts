import { unstable_cache } from "next/cache";
import { SCHEDULE_CACHE_TAG_AGGREGATES } from "@/lib/scheduleCacheTags";
import { fetchClassroomScheduleLabel } from "@/lib/classroomsRegistry";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";
import { supabase } from "@/lib/supabase";
import { isInactiveTutorName, loadInactiveTutorNames } from "@/lib/tutorVisibility";
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
    if (!id || !fromDate || !toDate) continue;
    out.push({
      id,
      fromDate,
      toDate,
      time: String(o.time ?? ""),
      room: String(o.room ?? ""),
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

async function loadStatesForYear(
  studentIds: string[],
  year: number,
): Promise<Map<string, YearLessonState>> {
  const map = new Map<string, YearLessonState>();
  for (const id of studentIds) {
    map.set(id, emptyState());
  }

  if (year === 2026 && studentIds.length > 0) {
    const { data: legacy } = await supabase
      .from("student_lessons_2026_state")
      .select("student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
      .in("student_id", studentIds);
    for (const row of legacy ?? []) {
      map.set(row.student_id, dbRowToState(row));
    }
  }

  if (studentIds.length > 0) {
    const { data: yearRows } = await supabase
      .from("student_lessons_year_state")
      .select("student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
      .eq("year", year)
      .in("student_id", studentIds);
    for (const row of yearRows ?? []) {
      map.set(row.student_id, dbRowToState(row));
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
  inactiveEffectiveById: Map<string, string>;
};

async function loadStudentsScheduleBundle(year: number): Promise<{
  bundle: StudentsScheduleBundle | null;
  error: string | null;
}> {
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
  const { data: visibilityRows } = await supabase
    .from("student_visibility_modes")
    .select("student_id, mode, effective_date")
    .in("student_id", ids);
  const manualInactiveEffectiveById = new Map<string, string>();
  for (const row of visibilityRows ?? []) {
    const mode = String((row as any).mode ?? "active").toLowerCase();
    if (mode !== "inactive") continue;
    const sid = String((row as any).student_id ?? "");
    const eff = String((row as any).effective_date ?? "");
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

  const { data: recRows, error: recErr } = await supabase
    .from("student_lesson_records")
    .select("student_id, records")
    .in("student_id", ids);

  if (recErr) {
    return { bundle: null, error: recErr.message };
  }

  const recMap = new Map<string, unknown>();
  for (const r of recRows ?? []) {
    recMap.set(r.student_id, r.records);
  }

  const stateMap = await loadStatesForYear(ids, year);
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
  for (const st of students) {
    normalizedRecordsById.set(st.id, normalizeRecords(recMap.get(st.id)));
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

  for (const st of students) {
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
        attended: Boolean(state.attendance[r.attendanceKey]),
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

  const inactiveNames = await loadInactiveTutorNames();
  for (const r of out) {
    if (isInactiveTutorName(inactiveNames, r.tutor)) r.tutor = "";
  }

  const sortedRows = sortAggregatedRoomRows(out);
  if (PERF_LOG_ENABLED) {
    const elapsedMs = Date.now() - perfStartedAt;
    const computeMs = Math.max(0, elapsedMs - perfDbElapsedMs);
    console.info(
      `[perf] fetchRoomScheduleAggregate slug=${slug} room=${roomLabel} y=${year} m=${month} students=${students.length} rows=${sortedRows.length} dbMs=${perfDbElapsedMs} computeMs=${computeMs} elapsedMs=${elapsedMs}`,
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
        attended: Boolean(state.attendance[r.attendanceKey]),
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
