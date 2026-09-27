"use client";

import {
  coerceProgressSelectionMap,
  type ProgressSelectionMap,
  type StudentProgressSelectionsRow,
} from "@/lib/studentProgressSelections";

export async function loadStudentProgressSelectionsClient(
  studentId: string,
): Promise<{
  row: StudentProgressSelectionsRow | null;
  error?: string;
  tableMissing?: boolean;
  backend?: "table" | "storage" | "none";
}> {
  const qs = new URLSearchParams({ studentId });
  const res = await fetch(`/api/student-progress/selections?${qs}`, {
    method: "GET",
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    selections?: unknown;
    updatedAt?: string | null;
    error?: string;
    tableMissing?: boolean;
    backend?: "table" | "storage" | "none";
  };
  if (!res.ok || !body.ok) {
    return {
      row: null,
      error: body.error ?? `HTTP ${res.status}`,
      tableMissing: Boolean(body.tableMissing),
      backend: body.backend,
    };
  }
  return {
    row: {
      studentId,
      selections: coerceProgressSelectionMap(body.selections),
      updatedAt: body.updatedAt ?? null,
    },
    tableMissing: Boolean(body.tableMissing),
    backend: body.backend,
  };
}

export async function saveStudentProgressSelectionsClient(params: {
  studentId: string;
  selections: ProgressSelectionMap;
  updatedBy?: string;
}): Promise<{
  ok: boolean;
  updatedAt?: string;
  error?: string;
  tableMissing?: boolean;
  backend?: "table" | "storage";
}> {
  const res = await fetch("/api/student-progress/selections", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      studentId: params.studentId,
      selections: params.selections,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    updatedAt?: string | null;
    error?: string;
    tableMissing?: boolean;
    backend?: "table" | "storage";
  };
  if (!res.ok || !body.ok) {
    return {
      ok: false,
      error: body.error ?? `HTTP ${res.status}`,
      tableMissing: Boolean(body.tableMissing),
      backend: body.backend,
    };
  }
  return {
    ok: true,
    updatedAt: body.updatedAt ?? undefined,
    tableMissing: Boolean(body.tableMissing),
    backend: body.backend,
  };
}
