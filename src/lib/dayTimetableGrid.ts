import { supabase } from "@/lib/supabase";
import { unstable_cache } from "next/cache";
import {
  LESSON_TYPE_DISPLAY_PRIORITY,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";
import { readYmdParts } from "@/lib/intlFormatParts";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";
import { TUTOR_STATUS_INACTIVE } from "@/lib/tutorVisibility";

export const ROOM_GROUPS = ["B", "M前", "M後", "Hope", "Hope 2"] as const;

export type RoomGroup = (typeof ROOM_GROUPS)[number];

export type DayTimetableCell = {
  studentId: string;
  name: string;
  grade: string;
  /** 課表／Lesson Summary 帶入；若無「當日備註」則顯示此文字 */
  scheduleRemarks: string;
  lessonType: "恆常" | "補堂" | "加堂" | "取消";
  tutorDisplay: string;
  tutorColorHex?: string;
};

export type DayTimetableRowFrame = { time: string; maxRows: number };

export type DayTimetablePayload = {
  year: number;
  month: number;
  day: number;
  dateIso: string;
  titleDate: string;
  examById: Record<string, string>;
  timetableRemarksById: Record<string, string>;
  byTimeRoom: Record<string, DayTimetableCell[]>;
  rowFrames: DayTimetableRowFrame[];
  /** 各房恆常每時段人數上限（Rooms 可改；未設定欄位時用預設） */
  regularPeriodMaxByRoom: Record<RoomGroup, number>;
};

const FALLBACK_CELL_BG = "#f1f5f9";

type StudentRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  nickname_en: string | null;
  grade: string | null;
};

function normalizeTutorHex(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

function buildTutorColorByDisplayName(
  rows: Array<{
    name?: string | null;
    name_zh?: string | null;
    name_en?: string | null;
    color_hex?: string | null;
    status?: string | null;
  }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of rows) {
    if (String(t.status ?? "").trim() === TUTOR_STATUS_INACTIVE) continue;
    const n = String(t.name ?? "").trim();
    const z = String(t.name_zh ?? "").trim();
    const en = String(t.name_en ?? "").trim();
    const hex = normalizeTutorHex(String(t.color_hex ?? "")) ?? FALLBACK_CELL_BG;
    if (n) map.set(n, hex);
    if (z) map.set(z, hex);
    if (en) map.set(en, hex);
  }
  return map;
}

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

function weekdayCnFromIsoDate(dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return "";
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return names[dt.getDay()] ?? "";
}

function toHkIsoDateFromMs(ms: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const { y, m, d } = readYmdParts(parts, { y: "2026", m: "01", d: "01" });
  return `${y}-${m}-${d}`;
}

type DayBuiltRow = {
  date: string;
  time: string;
  room: string;
  lessonType: "恆常" | "補堂" | "加堂" | "取消";
  tutorDisplay: string;
  noteDisplay: string;
};

function buildRowsForTargetDate(
  records: YearLessonRecord[],
  state: YearLessonState,
  targetDateIso: string,
  targetWeekday: string,
): DayBuiltRow[] {
  const normalized = records.map((r) => ({
    ...r,
    effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
  }));
  const sortedRules = [...normalized].sort((a, b) => {
    const ed = String(a.effectiveDate).localeCompare(String(b.effectiveDate));
    if (ed !== 0) return ed;
    return a.createdAt - b.createdAt;
  });
  let activeRule: (typeof sortedRules)[0] | null = sortedRules.length > 0 ? sortedRules[0] : null;
  for (let i = 1; i < sortedRules.length; i++) {
    if (String(sortedRules[i].effectiveDate) <= targetDateIso) activeRule = sortedRules[i];
    else break;
  }

  type Row = {
    date: string;
    time: string;
    room: string;
    rowKind: "normal" | "cancelled_original" | "reschedule";
    baseRule: (typeof sortedRules)[0] | null;
    fromExtra: boolean;
    rowId: string;
  };
  const rows: Row[] = [];

  const rule = activeRule;
  if (rule && targetWeekday === rule.weekday && !state.hiddenDates[targetDateIso]) {
    const ov = state.overrides[targetDateIso];
    rows.push({
      date: targetDateIso,
      time: (ov?.time ?? rule.time).toString(),
      room: (ov?.room ?? rule.room).toString(),
      rowKind: "normal",
      baseRule: rule,
      fromExtra: false,
      rowId: `${targetDateIso}-gen`,
    });
  }

  for (const e of state.rescheduleEntries) {
    const idx = rows.findIndex((r) => r.date === e.fromDate && r.rowKind === "normal");
    if (idx === -1) continue;
    const orig = rows[idx];
    rows.splice(idx, 1, {
      ...orig,
      time: orig.baseRule ? (state.overrides[e.fromDate]?.time ?? orig.baseRule.time).toString() : orig.time,
      room: orig.baseRule ? (state.overrides[e.fromDate]?.room ?? orig.baseRule.room).toString() : orig.room,
      rowKind: "cancelled_original",
      rowId: `cancelled-${e.id}-${e.fromDate}`,
    });
    rows.splice(idx + 1, 0, {
      date: e.toDate,
      time: e.time,
      room: e.room,
      rowKind: "reschedule",
      baseRule: null,
      fromExtra: false,
      rowId: `reschedule-${e.id}`,
    });
  }

  for (const ex of state.extraEntries) {
    if (ex.date !== targetDateIso) continue;
    rows.push({
      date: ex.date,
      time: ex.time,
      room: ex.room,
      rowKind: "normal",
      baseRule: null,
      fromExtra: true,
      rowId: `extra-${ex.id}`,
    });
  }

  return rows
    .filter((r) => r.date === targetDateIso)
    .sort((a, b) => {
      const tc = a.time.localeCompare(b.time, "en", { numeric: true });
      if (tc !== 0) return tc;
      return a.rowId.localeCompare(b.rowId);
    })
    .map((r) => {
      let lessonType: DayBuiltRow["lessonType"] = "恆常";
      if (r.rowKind === "cancelled_original") lessonType = "取消";
      else if (r.rowKind === "reschedule") lessonType = "補堂";
      else if (r.fromExtra) lessonType = "加堂";

      const tutorDisplay =
        r.rowKind === "reschedule"
          ? ""
          : (state.overrides[r.date]?.tutor ?? r.baseRule?.tutor ?? "").toString().trim() || "待定";
      const noteDisplay =
        r.rowKind === "reschedule"
          ? ""
          : (state.overrides[r.date]?.lessonSummary ?? r.baseRule?.lessonSummary ?? "").toString().trim();

      return {
        date: r.date,
        time: r.time || "待定",
        room: r.room,
        lessonType,
        tutorDisplay,
        noteDisplay,
      };
    });
}

export function hkTodayYmd() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const { y: ys, m: ms, d: ds } = readYmdParts(parts, { y: "2026", m: "01", d: "01" });
  return { y: Number(ys) || 2026, m: Number(ms) || 1, d: Number(ds) || 1 };
}

export function parseDayParams(sp: { year?: string; month?: string; day?: string } | undefined) {
  const now = hkTodayYmd();
  const year = Number(sp?.year ?? now.y) || now.y;
  const month = Math.min(12, Math.max(1, Number(sp?.month ?? now.m) || now.m));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(daysInMonth, Math.max(1, Number(sp?.day ?? now.d) || now.d));
  return { year, month, day, daysInMonth };
}

export function toDayIso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeYearState(raw: unknown): YearLessonState {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    attendance: (obj.attendance as Record<string, boolean>) ?? {},
    hiddenDates: (obj.hidden_dates as Record<string, boolean>) ?? (obj.hiddenDates as Record<string, boolean>) ?? {},
    overrides: (obj.overrides as YearLessonState["overrides"]) ?? {},
    rescheduleEntries: (obj.reschedule_entries as YearLessonState["rescheduleEntries"]) ?? [],
    extraEntries: (obj.extra_entries as YearLessonState["extraEntries"]) ?? [],
  };
}

function normalizeRecords(raw: unknown): YearLessonRecord[] {
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

export function normalizeRoom(roomRaw: string) {
  const raw = (roomRaw ?? "").trim().toLowerCase();
  if (!raw) return "";
  const compact = raw
    .replace(/\s+/g, "")
    .replace(/[-_]/g, "")
    .replace(/room/g, "")
    .replace(/房間/g, "房");

  if (compact === "b" || compact === "b房") return "B";
  if (compact === "m前" || compact === "m前房" || compact === "mfront" || compact === "m前room") {
    return "M前";
  }
  if (compact === "m後" || compact === "m後房" || compact === "mback" || compact === "m後room") {
    return "M後";
  }
  if (compact === "hope" || compact === "hope房") return "Hope";
  if (compact === "hope2" || compact === "hope2房") return "Hope 2";

  if (compact.includes("m前") || compact.includes("mfront")) return "M前";
  if (compact.includes("m後") || compact.includes("mback")) return "M後";
  if (compact.includes("hope2")) return "Hope 2";
  if (compact.includes("hope")) return "Hope";
  if (compact === "broom") return "B";

  return "";
}

/** 未在 classrooms.regular_period_max 設定時的預設上限 */
export const DEFAULT_REGULAR_PERIOD_MAX_BY_ROOM: Record<RoomGroup, number> = {
  B: 5,
  M前: 5,
  M後: 6,
  Hope: 6,
  "Hope 2": 5,
};

export function buildRegularPeriodMaxByRoom(
  classroomRows: Array<{ name?: string | null; regular_period_max?: number | null }> | null | undefined,
): Record<RoomGroup, number> {
  const out: Record<RoomGroup, number> = { ...DEFAULT_REGULAR_PERIOD_MAX_BY_ROOM };
  for (const row of classroomRows ?? []) {
    const label = normalizeRoom(String(row.name ?? ""));
    if (!label || !ROOM_GROUPS.includes(label as RoomGroup)) continue;
    const m = Number(row.regular_period_max);
    if (Number.isFinite(m) && m > 0) {
      out[label as RoomGroup] = Math.min(99, Math.max(1, Math.floor(m)));
    }
  }
  return out;
}

export type FetchDayTimetableOptions = {
  /** true：只顯示恆常排課（不含補堂／加堂） */
  regularOnly: boolean;
};

async function fetchDayTimetablePayloadUncached(
  year: number,
  month: number,
  day: number,
  options: FetchDayTimetableOptions,
): Promise<DayTimetablePayload> {
  const dateIso = toDayIso(year, month, day);
  const targetWeekday = weekdayCnFromIsoDate(dateIso);
  const titleDate = `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
  const { regularOnly } = options;

  const [
    { data: students },
    { data: recRows },
    { data: stateRows },
    { data: examRows },
    { data: remarkRows },
    { data: visibilityRows },
    { data: tutorRows },
    { data: classroomRows },
  ] = await Promise.all([
    supabase.from("students").select("id, name_zh, name_en, nickname_en, grade").order("id"),
    supabase.from("student_lesson_records").select("student_id, records"),
    supabase
      .from("student_lessons_year_state")
      .select("student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
      .eq("year", year),
    // 與學生獨立課堂頁 ExamDateField（saveExamDate）同一資料來源
    supabase.from("student_exam_dates").select("student_id, exam_date"),
    supabase.from("student_timetable_day_remarks").select("student_id, remarks").eq("date_iso", dateIso),
    supabase.from("student_visibility_modes").select("student_id, mode, effective_date"),
    supabase.from("tutors").select("name, name_zh, name_en, color_hex, status"),
    supabase.from("classrooms").select("name, regular_period_max"),
  ]);

  const regularPeriodMaxByRoom = buildRegularPeriodMaxByRoom(
    classroomRows as Array<{ name?: string | null; regular_period_max?: number | null }> | null,
  );

  const tutorColorByName = buildTutorColorByDisplayName(tutorRows ?? []);

  const studentList = (students ?? []) as StudentRow[];
  const recordsById = new Map<string, unknown>();
  for (const row of recRows ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (sid) recordsById.set(sid, (row as { records?: unknown }).records);
  }
  const stateById = new Map<string, YearLessonState>();
  for (const row of stateRows ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (sid) stateById.set(sid, normalizeYearState(row));
  }
  const examById: Record<string, string> = {};
  for (const row of examRows ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (sid) examById[sid] = String((row as { exam_date?: string | null }).exam_date ?? "");
  }
  const timetableRemarksById: Record<string, string> = {};
  for (const row of remarkRows ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    timetableRemarksById[sid] = String((row as { remarks?: string | null }).remarks ?? "");
  }
  const manualInactiveEffectiveById = new Map<string, string>();
  for (const row of visibilityRows ?? []) {
    const r = row as { student_id?: string; mode?: string; effective_date?: string };
    const mode = String(r.mode ?? "active").toLowerCase();
    if (mode !== "inactive") continue;
    const sid = String(r.student_id ?? "");
    const eff = String(r.effective_date ?? "");
    if (sid && eff) manualInactiveEffectiveById.set(sid, eff);
  }

  const byTimeRoom: Record<string, DayTimetableCell[]> = {};
  const timeSet = new Set<string>();

  for (const st of studentList) {
    const inactiveEffective = resolveStudentInactiveEffectiveDate({
      grade: st.grade,
      manualInactiveEffective: manualInactiveEffectiveById.get(st.id),
      year,
    });
    if (inactiveEffective && inactiveEffective <= dateIso) continue;

    const records = normalizeRecords(recordsById.get(st.id));
    const state = stateById.get(st.id) ?? {
      attendance: {},
      hiddenDates: {},
      overrides: {},
      rescheduleEntries: [],
      extraEntries: [],
    };

    // 快速剪枝：若該生在這一天不可能有課，跳過整年展開（最耗時）。
    const hasRegularOnWeekday = targetWeekday
      ? records.some((r) => r.weekday === targetWeekday)
      : records.length > 0;
    const hasExtraOnDate = state.extraEntries.some((e) => e.date === dateIso);
    const hasRescheduleToDate = state.rescheduleEntries.some((e) => e.toDate === dateIso);
    if (!hasRegularOnWeekday && !hasExtraOnDate && !hasRescheduleToDate) continue;

    const dayRows = buildRowsForTargetDate(records, state, dateIso, targetWeekday)
      .map((r) => ({ ...r, normalizedRoom: normalizeRoom(r.room) }))
      .filter((r) => {
        if (r.lessonType === "取消") return false;
        if (regularOnly && r.lessonType !== "恆常") return false;
        return ROOM_GROUPS.includes(r.normalizedRoom as RoomGroup);
      });

    for (const row of dayRows) {
      const time = row.time || "—";
      const room = row.normalizedRoom as RoomGroup;
      const key = `${time}::${room}`;
      const list = byTimeRoom[key] ?? [];
      const tutorDisplay = row.tutorDisplay ?? "";
      const tutorKey = tutorDisplay.trim();
      const tutorColorHex =
        tutorKey && tutorKey !== "待定" && tutorKey !== "—"
          ? tutorColorByName.get(tutorKey)
          : undefined;
      list.push({
        studentId: st.id,
        name: formatStudentDisplayName(
          { id: st.id, name_zh: st.name_zh, name_en: st.name_en, nickname_en: st.nickname_en },
          "compact",
        ),
        grade: st.grade ?? "",
        scheduleRemarks: row.noteDisplay ?? "",
        lessonType: row.lessonType,
        tutorDisplay,
        tutorColorHex,
      });
      byTimeRoom[key] = list;
      timeSet.add(time);
    }
  }

  for (const key of Object.keys(byTimeRoom)) {
    const list = byTimeRoom[key];
    list.sort((a, b) => {
      const pa = LESSON_TYPE_DISPLAY_PRIORITY[a.lessonType] ?? 9;
      const pb = LESSON_TYPE_DISPLAY_PRIORITY[b.lessonType] ?? 9;
      if (pa !== pb) return pa - pb;
      return a.studentId.localeCompare(b.studentId);
    });
  }

  const times = Array.from(timeSet).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const rowFrames = times.map((time) => {
    let maxRows = 1;
    for (const room of ROOM_GROUPS) {
      const size = (byTimeRoom[`${time}::${room}`] ?? []).length;
      if (size > maxRows) maxRows = size;
    }
    return { time, maxRows };
  });

  return {
    year,
    month,
    day,
    dateIso,
    titleDate,
    examById,
    timetableRemarksById,
    byTimeRoom,
    rowFrames,
    regularPeriodMaxByRoom,
  };
}

const fetchDayTimetablePayloadCached = unstable_cache(
  async (year: number, month: number, day: number, regularOnly: boolean) =>
    fetchDayTimetablePayloadUncached(year, month, day, { regularOnly }),
  ["day-timetable-payload-v1"],
  { revalidate: 20 },
);

export async function fetchDayTimetablePayload(
  year: number,
  month: number,
  day: number,
  options: FetchDayTimetableOptions,
): Promise<DayTimetablePayload> {
  return fetchDayTimetablePayloadCached(year, month, day, options.regularOnly);
}
