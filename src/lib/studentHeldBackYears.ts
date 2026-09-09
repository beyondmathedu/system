import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("student_held_back_years") &&
      (m.includes("could not find") || m.includes("not found")))
  );
}

/** Academic years (Sept 1 calendar year) when this student does not promote. */
export type HeldBackYearsByStudentId = Record<string, number[]>;

/**
 * Promotion year for 「本学年留班」:
 * the Sept 1 of this calendar year (Jan–Aug = upcoming Sept; Sept–Dec = Sept already started).
 * Example: May 2026 or Oct 2026 → 2026 (= 2026/9–2027/8).
 */
export function currentHeldBackPromotionYear(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  return Number.isFinite(y) ? y : now.getFullYear();
}

export function heldBackYearLabel(promotionYear: number): string {
  return `${promotionYear}/${String(promotionYear + 1).slice(-2)}学年（${promotionYear}/9–${promotionYear + 1}/8）`;
}

export function normalizeHeldBackYears(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of raw) {
    const y = Math.trunc(Number(v));
    if (!Number.isFinite(y) || y < 2000 || y > 2100 || seen.has(y)) continue;
    seen.add(y);
    out.push(y);
  }
  return out.sort((a, b) => a - b);
}

function yearFromRow(row: Record<string, unknown>): number {
  return Math.trunc(Number(row.promotion_year ?? row.academic_year));
}

export async function loadHeldBackYearsByStudentIds(
  studentIds: string[],
): Promise<{ byStudentId: HeldBackYearsByStudentId; error?: string; tableMissing?: boolean }> {
  if (!studentIds.length) return { byStudentId: {} };

  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    query: (chunk) =>
      supabase.from("student_held_back_years").select("student_id, promotion_year").in("student_id", chunk),
  });

  if (error) {
    return {
      byStudentId: {},
      error,
      tableMissing: isMissingTableError(error),
    };
  }

  const byStudentId: HeldBackYearsByStudentId = {};
  for (const row of data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    const year = yearFromRow(row as Record<string, unknown>);
    if (!sid || !Number.isFinite(year)) continue;
    if (!byStudentId[sid]) byStudentId[sid] = [];
    byStudentId[sid].push(year);
  }
  for (const sid of Object.keys(byStudentId)) {
    byStudentId[sid] = normalizeHeldBackYears(byStudentId[sid]);
  }
  return { byStudentId };
}

/** Replace held-back years for one student (client). */
export async function replaceStudentHeldBackYears(
  studentId: string,
  years: number[],
  note = "",
): Promise<{ ok: boolean; error?: string; tableMissing?: boolean }> {
  const { supabase } = await import("@/lib/supabase");
  const normalized = normalizeHeldBackYears(years);
  const { error: delError } = await supabase
    .from("student_held_back_years")
    .delete()
    .eq("student_id", studentId);
  if (delError) {
    return {
      ok: false,
      error: delError.message,
      tableMissing: isMissingTableError(delError.message),
    };
  }
  if (!normalized.length) return { ok: true };

  const rows = normalized.map((promotion_year) => ({
    student_id: studentId,
    promotion_year,
    note: note || "留班",
    updated_at: new Date().toISOString(),
  }));
  const { error: insError } = await supabase.from("student_held_back_years").insert(rows);
  if (insError) {
    return {
      ok: false,
      error: insError.message,
      tableMissing: isMissingTableError(insError.message),
    };
  }
  return { ok: true };
}
