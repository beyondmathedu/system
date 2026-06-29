import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";

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

export type StudentsListParams = {
  offset: number;
  limit: number;
  q?: string;
  status?: "all" | "active" | "inactive";
};

export type StudentsListResult = {
  rows: StudentsListRow[];
  total: number;
  hasMore: boolean;
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
  manualInactiveEffectiveById: Record<string, string>,
  status: StudentsListParams["status"],
  todayHkIso: string,
  year: number,
): boolean {
  if (!status || status === "all") return true;
  const eff = resolveStudentInactiveEffectiveDate({
    grade: row.grade ?? "",
    manualInactiveEffective: manualInactiveEffectiveById[row.id] ?? null,
    year,
  });
  const isInactive = Boolean(eff && eff <= todayHkIso);
  return status === "inactive" ? isInactive : !isInactive;
}

export async function listStudentsForPage(
  supabase: SupabaseClient,
  params: StudentsListParams,
): Promise<StudentsListResult> {
  const offset = Math.max(0, Math.floor(params.offset));
  const limit = Math.min(200, Math.max(1, Math.floor(params.limit)));
  const q = (params.q ?? "").trim();
  const status = params.status ?? "active";
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
    const manualInactiveEffectiveById = await loadManualInactiveMap(supabase, ids);

    const total = count ?? rows.length;
    return {
      rows,
      total,
      hasMore: offset + rows.length < total,
      manualInactiveEffectiveById,
    };
  }

  // Status filter uses grade + manual visibility — scan DB in chunks until page is filled.
  const manualInactiveEffectiveById: Record<string, string> = {};
  const matched: StudentsListRow[] = [];
  let scanOffset = 0;
  const scanChunk = Math.max(limit * 3, 120);
  let dbExhausted = false;

  while (matched.length < offset + limit) {
    let chunkQuery = supabase
      .from("students")
      .select(
        "id, name_zh, name_en, nickname_en, birth_date, student_phone, email, school, textbook_publisher, grade, math_language",
        scanOffset === 0 ? { count: "exact" } : undefined,
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
    if (!chunk.length) {
      dbExhausted = true;
      break;
    }

    const ids = chunk.map((r) => r.id).filter(Boolean);
    const chunkInactive = await loadManualInactiveMap(supabase, ids);
    Object.assign(manualInactiveEffectiveById, chunkInactive);

    for (const row of chunk) {
      if (!studentMatchesStatus(row, manualInactiveEffectiveById, status, todayHkIso, year)) continue;
      matched.push(row);
    }

    if (chunk.length < scanChunk) {
      dbExhausted = true;
      break;
    }
    scanOffset += scanChunk;
  }

  const pageRows = matched.slice(offset, offset + limit);
  const hasMore = !dbExhausted || matched.length > offset + limit;

  return {
    rows: pageRows,
    total: matched.length,
    hasMore,
    manualInactiveEffectiveById,
  };
}

async function loadManualInactiveMap(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!studentIds.length) return out;

  const { data, error } = await supabase
    .from("student_visibility_modes")
    .select("student_id, mode, effective_date")
    .in("student_id", studentIds);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const mode = String((row as { mode?: string }).mode ?? "").toLowerCase();
    if (mode !== "inactive") continue;
    const sid = String((row as { student_id?: string }).student_id ?? "");
    const eff = String((row as { effective_date?: string }).effective_date ?? "");
    if (sid && eff) out[sid] = eff;
  }
  return out;
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
