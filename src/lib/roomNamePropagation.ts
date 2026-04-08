import { supabase } from "@/lib/supabase";

const PAGE = 500;

function trimName(s: string): string {
  return s.trim();
}

function patchLessonRecords(records: unknown[], oldName: string, newName: string): { next: unknown[]; changed: boolean } {
  let changed = false;
  const next = records.map((item) => {
    if (!item || typeof item !== "object") return item;
    const o = item as Record<string, unknown>;
    if (o.room === oldName) {
      changed = true;
      return { ...o, room: newName };
    }
    return item;
  });
  return { next, changed };
}

function patchOverrides(
  overrides: Record<string, unknown>,
  oldName: string,
  newName: string,
): { next: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const next: Record<string, unknown> = { ...overrides };
  for (const [k, v] of Object.entries(overrides)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (o.room === oldName) {
      changed = true;
      next[k] = { ...o, room: newName };
    }
  }
  return { next, changed };
}

function patchRoomInObjectArray(
  arr: unknown[],
  oldName: string,
  newName: string,
): { next: unknown[]; changed: boolean } {
  let changed = false;
  const next = arr.map((item) => {
    if (!item || typeof item !== "object") return item;
    const o = item as Record<string, unknown>;
    if (o.room === oldName) {
      changed = true;
      return { ...o, room: newName };
    }
    return item;
  });
  return { next, changed };
}

export type PropagateRoomNameStats = {
  lessonRecordRows: number;
  lessons2026Rows: number;
  lessonsYearRows: number;
};

/**
 * 將課表 JSON 與 state 裡的 room 字串由 oldName 改為 newName（與 classrooms.name 一致時篩選才會命中）。
 */
export async function propagateClassroomNameChange(
  oldName: string,
  newName: string,
): Promise<{ ok: boolean; error?: string; stats: PropagateRoomNameStats }> {
  const oldTrim = trimName(oldName);
  const newTrim = trimName(newName);
  const stats: PropagateRoomNameStats = { lessonRecordRows: 0, lessons2026Rows: 0, lessonsYearRows: 0 };

  if (!oldTrim || !newTrim || oldTrim === newTrim) {
    return { ok: true, stats };
  }

  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("student_lesson_records")
      .select("student_id, records")
      .order("student_id")
      .range(offset, offset + PAGE - 1);

    if (error) {
      return { ok: false, error: error.message, stats };
    }
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const sid = String((row as { student_id?: string }).student_id ?? "");
      const raw = (row as { records?: unknown }).records;
      if (!sid || !Array.isArray(raw)) continue;
      const { next, changed } = patchLessonRecords(raw, oldTrim, newTrim);
      if (!changed) continue;
      const { error: upErr } = await supabase.from("student_lesson_records").upsert(
        {
          student_id: sid,
          records: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id" },
      );
      if (upErr) {
        return { ok: false, error: upErr.message, stats };
      }
      stats.lessonRecordRows += 1;
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("student_lessons_2026_state")
      .select("student_id, attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
      .order("student_id")
      .range(offset, offset + PAGE - 1);

    if (error) {
      return { ok: false, error: error.message, stats };
    }
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const sid = String((row as { student_id?: string }).student_id ?? "");
      if (!sid) continue;
      const overrides = (row as { overrides?: unknown }).overrides;
      const reschedule = (row as { reschedule_entries?: unknown }).reschedule_entries;
      const extra = (row as { extra_entries?: unknown }).extra_entries;

      let changed = false;
      let nextOverrides = overrides && typeof overrides === "object" ? { ...(overrides as Record<string, unknown>) } : {};
      let nextReschedule = Array.isArray(reschedule) ? [...reschedule] : [];
      let nextExtra = Array.isArray(extra) ? [...extra] : [];

      const po = patchOverrides(nextOverrides, oldTrim, newTrim);
      if (po.changed) {
        nextOverrides = po.next;
        changed = true;
      }
      const pr = patchRoomInObjectArray(nextReschedule, oldTrim, newTrim);
      if (pr.changed) {
        nextReschedule = pr.next;
        changed = true;
      }
      const pe = patchRoomInObjectArray(nextExtra, oldTrim, newTrim);
      if (pe.changed) {
        nextExtra = pe.next;
        changed = true;
      }

      if (!changed) continue;

      const { error: upErr } = await supabase.from("student_lessons_2026_state").upsert(
        {
          student_id: sid,
          attendance: (row as { attendance?: unknown }).attendance ?? {},
          hidden_dates: (row as { hidden_dates?: unknown }).hidden_dates ?? {},
          overrides: nextOverrides,
          reschedule_entries: nextReschedule,
          extra_entries: nextExtra,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id" },
      );
      if (upErr) {
        return { ok: false, error: upErr.message, stats };
      }
      stats.lessons2026Rows += 1;
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("student_lessons_year_state")
      .select("student_id, year, attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
      .order("student_id")
      .order("year")
      .range(offset, offset + PAGE - 1);

    if (error) {
      return { ok: false, error: error.message, stats };
    }
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const sid = String((row as { student_id?: string }).student_id ?? "");
      const year = Number((row as { year?: number }).year);
      if (!sid || !Number.isFinite(year)) continue;

      const overrides = (row as { overrides?: unknown }).overrides;
      const reschedule = (row as { reschedule_entries?: unknown }).reschedule_entries;
      const extra = (row as { extra_entries?: unknown }).extra_entries;

      let changed = false;
      let nextOverrides = overrides && typeof overrides === "object" ? { ...(overrides as Record<string, unknown>) } : {};
      let nextReschedule = Array.isArray(reschedule) ? [...reschedule] : [];
      let nextExtra = Array.isArray(extra) ? [...extra] : [];

      const po = patchOverrides(nextOverrides, oldTrim, newTrim);
      if (po.changed) {
        nextOverrides = po.next;
        changed = true;
      }
      const pr = patchRoomInObjectArray(nextReschedule, oldTrim, newTrim);
      if (pr.changed) {
        nextReschedule = pr.next;
        changed = true;
      }
      const pe = patchRoomInObjectArray(nextExtra, oldTrim, newTrim);
      if (pe.changed) {
        nextExtra = pe.next;
        changed = true;
      }

      if (!changed) continue;

      const { error: upErr } = await supabase.from("student_lessons_year_state").upsert(
        {
          student_id: sid,
          year,
          attendance: (row as { attendance?: unknown }).attendance ?? {},
          hidden_dates: (row as { hidden_dates?: unknown }).hidden_dates ?? {},
          overrides: nextOverrides,
          reschedule_entries: nextReschedule,
          extra_entries: nextExtra,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,year" },
      );
      if (upErr) {
        return { ok: false, error: upErr.message, stats };
      }
      stats.lessonsYearRows += 1;
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return { ok: true, stats };
}

export function suggestSlugFromDisplayName(name: string): string {
  const base = trimName(name)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length >= 2) return base.slice(0, 48);
  return "";
}

export function normalizeClassroomSlug(raw: string): string | null {
  const s = trimName(raw).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return null;
  if (s.length > 64) return null;
  return s;
}

export function getNextClassroomId(rows: { id: string }[]): string {
  const max = rows.reduce((m, r) => {
    const match = /^R(\d+)$/i.exec(r.id.trim());
    if (!match) return m;
    return Math.max(m, Number(match[1]));
  }, 0);
  return `R${String(max + 1).padStart(3, "0")}`;
}
