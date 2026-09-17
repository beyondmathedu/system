import { canonicalScheduleTimeLabel } from "@/lib/dayTimetableShared";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type TutorManualGuaranteeRow = {
  id: string;
  tutorId: string;
  dateIso: string;
  time: string;
  timeKey: string;
  note: string;
  createdAt: string;
};

function normalizeTimeKey(time: string): string {
  const canonical = canonicalScheduleTimeLabel(time);
  return canonical.trim().toLowerCase().replace(/\s+/g, " ");
}

function isTableMissingMessage(message: string | undefined): boolean {
  const m = String(message ?? "");
  return /\btutor_manual_guarantees\b/i.test(m) && /\bdoes not exist\b/i.test(m);
}

function mapRow(row: {
  id: string;
  tutor_id: string;
  lesson_date: string;
  lesson_time: string;
  time_key: string;
  note?: string | null;
  created_at?: string | null;
}): TutorManualGuaranteeRow {
  return {
    id: String(row.id),
    tutorId: String(row.tutor_id),
    dateIso: String(row.lesson_date).slice(0, 10),
    time: canonicalScheduleTimeLabel(String(row.lesson_time ?? "")),
    timeKey: String(row.time_key ?? ""),
    note: String(row.note ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

/** Load manual guarantees for one tutor within [startIso, endIso] (inclusive). */
export async function loadTutorManualGuaranteesForMonth(
  tutorId: string,
  startIso: string,
  endIso: string,
): Promise<{ rows: TutorManualGuaranteeRow[]; tableMissing: boolean; error: string | null }> {
  const id = String(tutorId ?? "").trim();
  if (!id) return { rows: [], tableMissing: false, error: null };
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("tutor_manual_guarantees")
      .select("id, tutor_id, lesson_date, lesson_time, time_key, note, created_at")
      .eq("tutor_id", id)
      .gte("lesson_date", startIso)
      .lte("lesson_date", endIso)
      .order("lesson_date", { ascending: true })
      .order("time_key", { ascending: true });
    if (error) {
      if (isTableMissingMessage(error.message)) {
        return { rows: [], tableMissing: true, error: null };
      }
      return { rows: [], tableMissing: false, error: error.message };
    }
    return {
      rows: (data ?? []).map((r) => mapRow(r as Parameters<typeof mapRow>[0])),
      tableMissing: false,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isTableMissingMessage(msg)) return { rows: [], tableMissing: true, error: null };
    return { rows: [], tableMissing: false, error: msg };
  }
}

export async function insertTutorManualGuarantee(input: {
  tutorId: string;
  dateIso: string;
  time: string;
  note?: string;
}): Promise<
  | { ok: true; row: TutorManualGuaranteeRow }
  | { ok: false; error: string; duplicate?: boolean; tableMissing?: boolean }
> {
  const tutorId = String(input.tutorId ?? "").trim();
  const dateIso = String(input.dateIso ?? "").trim().slice(0, 10);
  const time = canonicalScheduleTimeLabel(String(input.time ?? ""));
  const timeKey = normalizeTimeKey(time);
  const note = String(input.note ?? "").trim();

  if (!tutorId) return { ok: false, error: "請選擇 Tutor" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return { ok: false, error: "日期無效" };
  if (!time || !timeKey) return { ok: false, error: "請輸入時間" };

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("tutor_manual_guarantees")
      .insert({
        tutor_id: tutorId,
        lesson_date: dateIso,
        lesson_time: time,
        time_key: timeKey,
        note: note || null,
      })
      .select("id, tutor_id, lesson_date, lesson_time, time_key, note, created_at")
      .single();

    if (error) {
      if (isTableMissingMessage(error.message)) {
        return {
          ok: false,
          error: "尚未建立 tutor_manual_guarantees 資料表，請先執行 migration。",
          tableMissing: true,
        };
      }
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
        return { ok: false, error: "同一日期＋時間＋Tutor 已有保底記錄", duplicate: true };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true, row: mapRow(data as Parameters<typeof mapRow>[0]) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isTableMissingMessage(msg)) {
      return { ok: false, error: "尚未建立資料表", tableMissing: true };
    }
    return { ok: false, error: msg };
  }
}

export async function updateTutorManualGuarantee(input: {
  id: string;
  tutorId: string;
  dateIso: string;
  time: string;
  note?: string;
}): Promise<
  | { ok: true; row: TutorManualGuaranteeRow }
  | { ok: false; error: string; duplicate?: boolean; tableMissing?: boolean }
> {
  const id = String(input.id ?? "").trim();
  const tutorId = String(input.tutorId ?? "").trim();
  const dateIso = String(input.dateIso ?? "").trim().slice(0, 10);
  const time = canonicalScheduleTimeLabel(String(input.time ?? ""));
  const timeKey = normalizeTimeKey(time);
  const note = String(input.note ?? "").trim();

  if (!id) return { ok: false, error: "缺少 id" };
  if (!tutorId) return { ok: false, error: "請選擇 Tutor" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return { ok: false, error: "日期無效" };
  if (!time || !timeKey) return { ok: false, error: "請輸入時間" };

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("tutor_manual_guarantees")
      .update({
        tutor_id: tutorId,
        lesson_date: dateIso,
        lesson_time: time,
        time_key: timeKey,
        note: note || null,
      })
      .eq("id", id)
      .select("id, tutor_id, lesson_date, lesson_time, time_key, note, created_at")
      .single();

    if (error) {
      if (isTableMissingMessage(error.message)) {
        return {
          ok: false,
          error: "尚未建立 tutor_manual_guarantees 資料表，請先執行 migration。",
          tableMissing: true,
        };
      }
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
        return { ok: false, error: "同一日期＋時間＋Tutor 已有保底記錄", duplicate: true };
      }
      return { ok: false, error: error.message };
    }
    if (!data) return { ok: false, error: "找不到記錄" };
    return { ok: true, row: mapRow(data as Parameters<typeof mapRow>[0]) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isTableMissingMessage(msg)) {
      return { ok: false, error: "尚未建立資料表", tableMissing: true };
    }
    return { ok: false, error: msg };
  }
}

export async function deleteTutorManualGuarantee(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; tableMissing?: boolean }> {
  const guaranteeId = String(id ?? "").trim();
  if (!guaranteeId) return { ok: false, error: "缺少 id" };
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("tutor_manual_guarantees").delete().eq("id", guaranteeId);
    if (error) {
      if (isTableMissingMessage(error.message)) {
        return { ok: false, error: "尚未建立資料表", tableMissing: true };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isTableMissingMessage(msg)) return { ok: false, error: "尚未建立資料表", tableMissing: true };
    return { ok: false, error: msg };
  }
}

export function manualGuaranteeTimeKey(time: string): string {
  return normalizeTimeKey(time);
}
