import { fetchRowsInChunks } from "@/lib/supabaseBatchIn";
import { supabase } from "@/lib/supabase";

export const FEE_OPENING_BALANCE_AS_OF_YEAR = 2026;
export const FEE_OPENING_BALANCE_AS_OF_MONTH = 4;

const LOCAL_STORAGE_KEY = `fee_opening_balance_${FEE_OPENING_BALANCE_AS_OF_YEAR}_${String(FEE_OPENING_BALANCE_AS_OF_MONTH).padStart(2, "0")}`;

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("student_fee_opening_balances") &&
      (m.includes("could not find") || m.includes("not found")))
  );
}

export function readFeeOpeningBalancesFromLocal(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!k) continue;
      out[k] = Number(v) || 0;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeFeeOpeningBalanceToLocal(studentId: string, openingBalance: number): void {
  if (typeof window === "undefined") return;
  const all = readFeeOpeningBalancesFromLocal();
  const n = Number(openingBalance) || 0;
  if (Math.abs(n) < 0.005) delete all[studentId];
  else all[studentId] = n;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore quota / private mode
  }
}

export async function loadStudentFeeOpeningBalances(studentIds: string[]): Promise<{
  balances: Record<string, number>;
  error?: string;
  tableMissing?: boolean;
}> {
  if (studentIds.length === 0) return { balances: {} };

  const { data, error } = await fetchRowsInChunks({
    ids: studentIds,
    query: (chunk) =>
      supabase
        .from("student_fee_opening_balances")
        .select("student_id, opening_balance")
        .eq("as_of_year", FEE_OPENING_BALANCE_AS_OF_YEAR)
        .eq("as_of_month", FEE_OPENING_BALANCE_AS_OF_MONTH)
        .in("student_id", chunk),
  });

  const local = readFeeOpeningBalancesFromLocal();

  if (error) {
    return {
      balances: local,
      error,
      tableMissing: isMissingTableError(error),
    };
  }

  const fromDb: Record<string, number> = {};
  for (const row of data ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    fromDb[sid] = Number((row as { opening_balance?: number | null }).opening_balance ?? 0) || 0;
  }

  const merged = { ...local };
  for (const sid of studentIds) {
    if (sid in fromDb) merged[sid] = fromDb[sid];
  }
  return { balances: merged };
}

export async function upsertStudentFeeOpeningBalance(
  studentId: string,
  openingBalance: number,
): Promise<{ ok: boolean; error?: string; tableMissing?: boolean }> {
  const value = Number(openingBalance) || 0;
  const { error } = await supabase.from("student_fee_opening_balances").upsert(
    {
      student_id: studentId,
      as_of_year: FEE_OPENING_BALANCE_AS_OF_YEAR,
      as_of_month: FEE_OPENING_BALANCE_AS_OF_MONTH,
      opening_balance: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id,as_of_year,as_of_month" },
  );
  if (error) {
    return { ok: false, error: error.message, tableMissing: isMissingTableError(error.message) };
  }
  return { ok: true };
}
