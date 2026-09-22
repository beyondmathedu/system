/** Zoho sales-receipt date window for fee sync. */

function toIsoYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Receipt fetch window for Sync Zoho.
 *
 * Default: from 1 Jan of the sheet year through the end of (target month + 1).
 * That way a receipt dated earlier (e.g. 30 Jul) that bills a later month in
 * Item & Description (e.g. "Aug Fri") is still fetched when syncing September.
 *
 * Upsert still preserves non-target months that already have Tuition Paid.
 * `widenToFullYear` keeps the whole calendar year when explicitly requested.
 */
export function buildZohoSyncWindow(
  year: number,
  month: number,
  widenToFullYear: boolean,
): { dateStart: string; dateEnd: string } {
  const y = Math.floor(year);
  const m = Math.floor(month);
  if (widenToFullYear) {
    return { dateStart: `${y}-01-01`, dateEnd: `${y}-12-31` };
  }
  const base = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 2, 0));
  return { dateStart: `${y}-01-01`, dateEnd: toIsoYmdUtc(end) };
}
