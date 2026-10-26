/** Client/server helpers for deferred Zoho fee sync writes. */

export type MonthAmountMap = Record<string, Record<number, number>>;

export function addMonthAmountMap(
  target: Map<string, number>,
  source: MonthAmountMap | undefined,
): void {
  if (!source) return;
  for (const [studentId, months] of Object.entries(source)) {
    if (!studentId || !months) continue;
    for (const [monthStr, raw] of Object.entries(months)) {
      const month = Number(monthStr);
      const value = Number(raw) || 0;
      if (!month || month < 1 || month > 12 || !Number.isFinite(value) || value === 0) continue;
      const key = `${studentId}:${month}`;
      target.set(key, Math.round(((target.get(key) ?? 0) + value) * 100) / 100);
    }
  }
}

export function monthAmountMapFromKeyMap(source: Map<string, number>): MonthAmountMap {
  const out: MonthAmountMap = {};
  for (const [key, value] of source) {
    if (!Number.isFinite(value) || value === 0) continue;
    const [studentId, monthStr] = key.split(":");
    const month = Number(monthStr);
    if (!studentId || !month) continue;
    if (!out[studentId]) out[studentId] = {};
    out[studentId]![month] = value;
  }
  return out;
}

/** Merge prior batches + current batch key maps into a single student/month map. */
export function mergeZohoBatchTotals(
  prior: MonthAmountMap | undefined,
  batch: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  addMonthAmountMap(out, prior);
  for (const [key, value] of batch) {
    if (!Number.isFinite(value) || value === 0) continue;
    out.set(key, Math.round(((out.get(key) ?? 0) + value) * 100) / 100);
  }
  return out;
}
