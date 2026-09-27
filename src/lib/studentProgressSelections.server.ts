import "server-only";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  coerceProgressSelectionMap,
  loadStudentProgressSelections,
  saveStudentProgressSelections,
  type ProgressSelectionMap,
  type StudentProgressSelectionsRow,
} from "@/lib/studentProgressSelections";

const STORAGE_BUCKET = "student-progress-selections";

async function ensureStorageBucket(): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseAdmin();
  const listed = await supabase.storage.listBuckets();
  if (listed.error) return { ok: false, error: listed.error.message };
  if ((listed.data ?? []).some((b) => b.name === STORAGE_BUCKET)) return { ok: true };
  const created = await supabase.storage.createBucket(STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: 2_000_000,
  });
  if (created.error) return { ok: false, error: created.error.message };
  return { ok: true };
}

function storageObjectPath(studentId: string): string {
  return `${studentId}.json`;
}

async function loadFromStorage(studentId: string): Promise<{
  row: StudentProgressSelectionsRow | null;
  error?: string;
}> {
  const bucket = await ensureStorageBucket();
  if (!bucket.ok) return { row: null, error: bucket.error };
  const supabase = getSupabaseAdmin();
  const down = await supabase.storage.from(STORAGE_BUCKET).download(storageObjectPath(studentId));
  if (down.error) {
    const msg = down.error.message.toLowerCase();
    if (msg.includes("not found") || msg.includes("object")) return { row: null };
    return { row: null, error: down.error.message };
  }
  try {
    const text = await down.data.text();
    const parsed = JSON.parse(text) as { selections?: unknown; updatedAt?: unknown };
    return {
      row: {
        studentId,
        selections: coerceProgressSelectionMap(parsed.selections),
        updatedAt: parsed.updatedAt ? String(parsed.updatedAt) : null,
      },
    };
  } catch (e) {
    return { row: null, error: e instanceof Error ? e.message : "Invalid progress JSON" };
  }
}

async function saveToStorage(params: {
  studentId: string;
  selections: ProgressSelectionMap;
  updatedBy?: string;
}): Promise<{ ok: boolean; updatedAt?: string; error?: string }> {
  const bucket = await ensureStorageBucket();
  if (!bucket.ok) return { ok: false, error: bucket.error };
  const updatedAt = new Date().toISOString();
  const payload = JSON.stringify({
    selections: coerceProgressSelectionMap(params.selections),
    updatedAt,
    updatedBy: params.updatedBy ?? "",
  });
  const supabase = getSupabaseAdmin();
  const up = await supabase.storage.from(STORAGE_BUCKET).upload(storageObjectPath(params.studentId), payload, {
    contentType: "application/json",
    upsert: true,
  });
  if (up.error) return { ok: false, error: up.error.message };
  return { ok: true, updatedAt };
}

/** Load per-student progress selections: DB table first, then Storage fallback. */
export async function loadStudentProgressSelectionsDurable(studentId: string): Promise<{
  row: StudentProgressSelectionsRow | null;
  error?: string;
  backend: "table" | "storage" | "none";
  tableMissing?: boolean;
}> {
  const supabase = getSupabaseAdmin();
  const table = await loadStudentProgressSelections(supabase, studentId);
  if (!table.tableMissing) {
    return {
      row: table.row,
      error: table.error,
      backend: table.row ? "table" : "none",
      tableMissing: false,
    };
  }

  const storage = await loadFromStorage(studentId);
  return {
    row: storage.row,
    error: storage.error,
    backend: storage.row ? "storage" : "none",
    tableMissing: true,
  };
}

/** Save per-student progress selections: DB table first, then Storage fallback. */
export async function saveStudentProgressSelectionsDurable(params: {
  studentId: string;
  selections: ProgressSelectionMap;
  updatedBy?: string;
}): Promise<{
  ok: boolean;
  updatedAt?: string;
  error?: string;
  backend: "table" | "storage";
  tableMissing?: boolean;
}> {
  const supabase = getSupabaseAdmin();
  const table = await saveStudentProgressSelections(supabase, params);
  if (!table.tableMissing) {
    return {
      ok: table.ok,
      updatedAt: table.updatedAt,
      error: table.error,
      backend: "table",
      tableMissing: false,
    };
  }

  const storage = await saveToStorage(params);
  return {
    ok: storage.ok,
    updatedAt: storage.updatedAt,
    error: storage.error,
    backend: "storage",
    tableMissing: true,
  };
}
