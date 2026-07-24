import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildStudentInactivePeriodsById,
  isStudentInactiveOnDateFromPeriods,
  isTemporarilyInactiveOnDateFromPeriods,
  withAutoF6InactivePeriod,
} from "@/lib/studentVisibility";

export type StudentsListRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  nickname_en: string | null;
  birth_date: string | null;
  student_phone: string | null;
  email: string | null;
  school: string | null;
  textbook_publisher: string | null;
  grade: string | null;
  math_language: string | null;
};

/** Sub-filter when status is inactive. */
export type StudentsInactiveKind = "all" | "temporary" | "graduated";

export type StudentsListParams = {
  offset: number;
  limit: number;
  q?: string;
  status?: "all" | "active" | "inactive";
  /** Only applied when status === "inactive". Default: all inactive. */
  inactiveKind?: StudentsInactiveKind;
};

export type StudentsListResult = {
  rows: StudentsListRow[];
  total: number;
  hasMore: boolean;
  /** Compatibility payload for /api/students/list; contains active inactive-start for currently-inactive students only. */
  manualInactiveEffectiveById: Record<string, string>;
};

function hkTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function hkYear(now = new Date()): number {
  return Number(hkTodayIso(now).slice(0, 4)) || now.getFullYear();
}

function escapeIlikePattern(raw: string): string {
  return raw.replace(/[%_,]/g, "");
}

function studentMatchesStatus(
  row: StudentsListRow,
  inactivePeriodsById: Record<string, import("@/lib/studentVisibility").StudentInactivePeriod[]>,
  status: StudentsListParams["status"],
  inactiveKind: StudentsInactiveKind,
  todayHkIso: string,
  year: number,
): boolean {
  if (!status || status === "all") return true;
  const manualPeriods = inactivePeriodsById[row.id] ?? [];
  const periods = withAutoF6InactivePeriod({
    periods: manualPeriods,
    studentId: row.id,
    grade: row.grade ?? "",
    year,
  });
  const isInactive = isStudentInactiveOnDateFromPeriods({ periods, dateIso: todayHkIso });
  if (status === "active") return !isInactive;
  if (!isInactive) return false;

  if (inactiveKind === "all") return true;
  const isTemporary = isTemporarilyInactiveOnDateFromPeriods({
    periods,
    dateIso: todayHkIso,
  });
  if (inactiveKind === "temporary") return isTemporary;
  // graduated / permanent: inactive with no Expected return covering today
  return !isTemporary;
}

export async function listStudentsForPage(
  supabase: SupabaseClient,
  params: StudentsListParams,
): Promise<StudentsListResult> {
  const offset = Math.max(0, Math.floor(params.offset));
  const limit = Math.min(200, Math.max(1, Math.floor(params.limit)));
  const q = (params.q ?? "").trim();
  const status = params.status ?? "active";
  const inactiveKind: StudentsInactiveKind =
    params.inactiveKind === "temporary" || params.inactiveKind === "graduated"
      ? params.inactiveKind
      : "all";
  const todayHkIso = hkTodayIso();
  const year = hkYear();

  let query = supabase
    .from("students")
    .select(
      "id, name_zh, name_en, nickname_en, birth_date, student_phone, email, school, textbook_publisher, grade, math_language",
      { count: "exact" },
    )
    .order("id", { ascending: true });

  if (q) {
    const pattern = `%${escapeIlikePattern(q)}%`;
    query = query.or(
      [
        `id.ilike.${pattern}`,
        `name_zh.ilike.${pattern}`,
        `name_en.ilike.${pattern}`,
        `nickname_en.ilike.${pattern}`,
        `school.ilike.${pattern}`,
        `student_phone.ilike.${pattern}`,
        `email.ilike.${pattern}`,
      ].join(","),
    );
  }

  if (status === "all") {
    query = query.range(offset, offset + limit - 1);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as StudentsListRow[];
    const ids = rows.map((r) => r.id).filter(Boolean);
    const { currentInactiveStartById } = await loadInactivePeriodsMaps(supabase, ids, todayHkIso);

    const total = count ?? rows.length;
    return {
      rows,
      total,
      hasMore: offset + rows.length < total,
      manualInactiveEffectiveById: currentInactiveStartById,
    };
  }

  // Status filter uses grade + manual visibility — scan full list, then paginate.
  const { inactivePeriodsById, currentInactiveStartById } = await loadAllInactivePeriodsMaps(
    supabase,
    todayHkIso,
  );
  const matched: StudentsListRow[] = [];
  let scanOffset = 0;
  const scanChunk = 200;

  while (true) {
    let chunkQuery = supabase
      .from("students")
      .select(
        "id, name_zh, name_en, nickname_en, birth_date, student_phone, email, school, textbook_publisher, grade, math_language",
      )
      .order("id", { ascending: true })
      .range(scanOffset, scanOffset + scanChunk - 1);

    if (q) {
      const pattern = `%${escapeIlikePattern(q)}%`;
      chunkQuery = chunkQuery.or(
        [
          `id.ilike.${pattern}`,
          `name_zh.ilike.${pattern}`,
          `name_en.ilike.${pattern}`,
          `nickname_en.ilike.${pattern}`,
          `school.ilike.${pattern}`,
          `student_phone.ilike.${pattern}`,
          `email.ilike.${pattern}`,
        ].join(","),
      );
    }

    const { data, error } = await chunkQuery;
    if (error) throw new Error(error.message);

    const chunk = (data ?? []) as StudentsListRow[];
    if (!chunk.length) break;

    for (const row of chunk) {
      if (!studentMatchesStatus(row, inactivePeriodsById, status, inactiveKind, todayHkIso, year)) continue;
      matched.push(row);
    }

    if (chunk.length < scanChunk) break;
    scanOffset += scanChunk;
  }

  const total = matched.length;
  const pageRows = matched.slice(offset, offset + limit);

  return {
    rows: pageRows,
    total,
    hasMore: offset + pageRows.length < total,
    manualInactiveEffectiveById: currentInactiveStartById,
  };
}

async function loadInactivePeriodsMaps(
  supabase: SupabaseClient,
  studentIds: string[],
  todayHkIso: string,
): Promise<{
  inactivePeriodsById: Record<string, import("@/lib/studentVisibility").StudentInactivePeriod[]>;
  currentInactiveStartById: Record<string, string>;
}> {
  if (!studentIds.length) return { inactivePeriodsById: {}, currentInactiveStartById: {} };
  const { data, error } = await supabase
    .from("student_visibility_periods")
    .select("student_id, start_date, end_date, note")
    .in("student_id", studentIds)
    .order("start_date", { ascending: true });
  if (error) throw new Error(error.message);
  const inactivePeriodsById = buildStudentInactivePeriodsById(data ?? []);
  const currentInactiveStartById: Record<string, string> = {};
  for (const sid of studentIds) {
    const periods = inactivePeriodsById[sid] ?? [];
    const active = periods
      .filter((p) => p.startDate <= todayHkIso && (!p.endDate || todayHkIso < p.endDate))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    if (active) currentInactiveStartById[sid] = active.startDate;
  }
  return { inactivePeriodsById, currentInactiveStartById };
}

async function loadAllInactivePeriodsMaps(
  supabase: SupabaseClient,
  todayHkIso: string,
): Promise<{
  inactivePeriodsById: Record<string, import("@/lib/studentVisibility").StudentInactivePeriod[]>;
  currentInactiveStartById: Record<string, string>;
}> {
  const { data, error } = await supabase
    .from("student_visibility_periods")
    .select("student_id, start_date, end_date, note")
    .order("start_date", { ascending: true });
  if (error) throw new Error(error.message);
  const inactivePeriodsById = buildStudentInactivePeriodsById(data ?? []);
  const currentInactiveStartById: Record<string, string> = {};
  for (const [sid, periods] of Object.entries(inactivePeriodsById)) {
    const active = (periods ?? [])
      .filter((p) => p.startDate <= todayHkIso && (!p.endDate || todayHkIso < p.endDate))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    if (active) currentInactiveStartById[sid] = active.startDate;
  }
  return { inactivePeriodsById, currentInactiveStartById };
}

export async function fetchNextStudentIdFromDbServer(
  supabase: SupabaseClient,
): Promise<string> {
  const pageSize = 1000;
  let from = 0;
  let maxNumber = 0;

  while (true) {
    const { data, error } = await supabase
      .from("students")
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    const chunk = (data ?? []) as { id: string }[];
    for (const row of chunk) {
      const n = parseNumericStudentIdNumber(row.id);
      if (n != null) maxNumber = Math.max(maxNumber, n);
    }
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return formatStudentIdFromNumber(maxNumber + 1);
}

function parseNumericStudentIdNumber(id: string): number | null {
  const s = String(id ?? "").trim();
  const m = /^(\d+)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function formatStudentIdFromNumber(n: number): string {
  return String(Math.max(1, Math.round(n))).padStart(5, "0");
}
