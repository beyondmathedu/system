export type StudentFeeBalanceAdjustment = {
  amount: number;
  reason: string;
};

const LOCAL_STORAGE_KEY = "fee_balance_adjustments_v1";

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("student_fee_balance_adjustments") &&
      (m.includes("could not find") || m.includes("not found")))
  );
}

export function emptyFeeBalanceAdjustment(): StudentFeeBalanceAdjustment {
  return { amount: 0, reason: "" };
}

export function coerceFeeBalanceAdjustment(raw: unknown): StudentFeeBalanceAdjustment {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyFeeBalanceAdjustment();
  const o = raw as Record<string, unknown>;
  const amount = Number(o.amount);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    reason: String(o.reason ?? ""),
  };
}

export function readFeeBalanceAdjustmentsFromLocal(): Record<string, StudentFeeBalanceAdjustment> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, StudentFeeBalanceAdjustment> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!k) continue;
      out[k] = coerceFeeBalanceAdjustment(v);
    }
    return out;
  } catch {
    return {};
  }
}

export function writeFeeBalanceAdjustmentToLocal(
  studentId: string,
  adjustment: StudentFeeBalanceAdjustment,
): void {
  if (typeof window === "undefined") return;
  const all = readFeeBalanceAdjustmentsFromLocal();
  const amount = Number(adjustment.amount) || 0;
  const reason = String(adjustment.reason ?? "");
  if (Math.abs(amount) < 0.005 && !reason.trim()) delete all[studentId];
  else all[studentId] = { amount, reason };
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore quota / private mode
  }
}

export async function loadStudentFeeBalanceAdjustments(studentIds: string[]): Promise<{
  adjustments: Record<string, StudentFeeBalanceAdjustment>;
  error?: string;
  tableMissing?: boolean;
}> {
  if (studentIds.length === 0) return { adjustments: {} };

  const { fetchRowsInChunks } = await import("@/lib/supabaseBatchIn");
  const { supabase } = await import("@/lib/supabase");

  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    query: (chunk) =>
      supabase
        .from("student_fee_balance_adjustments")
        .select("student_id, amount, reason")
        .in("student_id", chunk),
  });

  const local = readFeeBalanceAdjustmentsFromLocal();

  if (error) {
    return {
      adjustments: local,
      error,
      tableMissing: isMissingTableError(error),
    };
  }

  const fromDb: Record<string, StudentFeeBalanceAdjustment> = {};
  for (const row of data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    fromDb[sid] = {
      amount: Number((row as { amount?: number | null }).amount ?? 0) || 0,
      reason: String((row as { reason?: string | null }).reason ?? ""),
    };
  }

  return { adjustments: { ...fromDb, ...local } };
}

export async function upsertStudentFeeBalanceAdjustment(
  studentId: string,
  adjustment: StudentFeeBalanceAdjustment,
): Promise<{ ok: boolean; error?: string; tableMissing?: boolean }> {
  const amount = Number(adjustment.amount) || 0;
  const reason = String(adjustment.reason ?? "");
  try {
    const res = await fetch("/api/students-lesson-fee-record/balance-adjustment", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, amount, reason }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      tableMissing?: boolean;
    };
    if (body.ok) return { ok: true };
    return {
      ok: false,
      error: body.error ?? `HTTP ${res.status}`,
      tableMissing: Boolean(body.tableMissing),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Network error";
    return { ok: false, error: message, tableMissing: isMissingTableError(message) };
  }
}
