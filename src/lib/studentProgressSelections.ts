export type ProgressSelectionMap = Record<string, string>;

export type StudentProgressSelectionsRow = {
  studentId: string;
  selections: ProgressSelectionMap;
  updatedAt: string | null;
};

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("student_progress_selections") &&
      (m.includes("could not find") || m.includes("not found")))
  );
}

export function coerceProgressSelectionMap(raw: unknown): ProgressSelectionMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ProgressSelectionMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (value == null) continue;
    const text = String(value);
    if (!text.trim()) continue;
    out[key] = text;
  }
  return out;
}

export function progressSelectionsEqual(a: ProgressSelectionMap, b: ProgressSelectionMap): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

type SupabaseFromClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export async function loadStudentProgressSelections(
  supabase: SupabaseFromClient,
  studentId: string,
): Promise<{
  row: StudentProgressSelectionsRow | null;
  error?: string;
  tableMissing?: boolean;
}> {
  const { data, error } = await supabase
    .from("student_progress_selections")
    .select("student_id, selections, updated_at")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    return {
      row: null,
      error: error.message,
      tableMissing: isMissingTableError(error.message),
    };
  }
  if (!data || typeof data !== "object") {
    return { row: null };
  }
  const o = data as Record<string, unknown>;
  return {
    row: {
      studentId: String(o.student_id ?? studentId),
      selections: coerceProgressSelectionMap(o.selections),
      updatedAt: o.updated_at ? String(o.updated_at) : null,
    },
  };
}

export async function saveStudentProgressSelections(
  supabase: SupabaseFromClient,
  params: {
    studentId: string;
    selections: ProgressSelectionMap;
    updatedBy?: string;
  },
): Promise<{ ok: boolean; updatedAt?: string; error?: string; tableMissing?: boolean }> {
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from("student_progress_selections").upsert(
    {
      student_id: params.studentId,
      selections: coerceProgressSelectionMap(params.selections),
      updated_at: updatedAt,
      updated_by: params.updatedBy ?? "",
    },
    { onConflict: "student_id" },
  );
  if (error) {
    return {
      ok: false,
      error: error.message,
      tableMissing: isMissingTableError(error.message),
    };
  }
  return { ok: true, updatedAt };
}
