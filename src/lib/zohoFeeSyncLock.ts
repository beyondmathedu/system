/** Per-year Zoho Sync lock: months in [from, to] inclusive are never overwritten by Sync. */

export type ZohoFeeSyncLockPeriod = {
  /** 0 = unlocked; 1–12 = start month inclusive */
  fromMonth: number;
  /** 0 = unlocked; 1–12 = end month inclusive */
  toMonth: number;
};

const LEGACY_THROUGH_KEY_PREFIX = "zoho-fee-sync-lock-through-month:";
const PERIOD_KEY_PREFIX = "zoho-fee-sync-lock-period:";

function periodKey(year: number): string {
  return `${PERIOD_KEY_PREFIX}${year}`;
}

function legacyThroughKey(year: number): string {
  return `${LEGACY_THROUGH_KEY_PREFIX}${year}`;
}

function clampMonth(n: unknown): number {
  const m = Math.floor(Number(n));
  if (!Number.isFinite(m) || m < 1 || m > 12) return 0;
  return m;
}

export function normalizeZohoFeeSyncLockPeriod(
  fromMonth: number,
  toMonth: number,
): ZohoFeeSyncLockPeriod {
  const from = clampMonth(fromMonth);
  const to = clampMonth(toMonth);
  if (!from || !to) return { fromMonth: 0, toMonth: 0 };
  return from <= to ? { fromMonth: from, toMonth: to } : { fromMonth: to, toMonth: from };
}

/** Load lock period; migrates legacy "lock through N" (1…N) if present. */
export function loadZohoFeeSyncLockPeriod(year: number): ZohoFeeSyncLockPeriod {
  if (typeof window === "undefined") return { fromMonth: 0, toMonth: 0 };
  try {
    const raw = window.localStorage.getItem(periodKey(year));
    if (raw) {
      const parsed = JSON.parse(raw) as { fromMonth?: unknown; toMonth?: unknown };
      return normalizeZohoFeeSyncLockPeriod(
        Number(parsed?.fromMonth ?? 0),
        Number(parsed?.toMonth ?? 0),
      );
    }
    const legacy = window.localStorage.getItem(legacyThroughKey(year));
    if (legacy != null && legacy !== "") {
      const through = clampMonth(legacy);
      if (through) {
        const migrated = { fromMonth: 1, toMonth: through };
        saveZohoFeeSyncLockPeriod(year, migrated.fromMonth, migrated.toMonth);
        window.localStorage.removeItem(legacyThroughKey(year));
        return migrated;
      }
    }
  } catch {
    /* ignore */
  }
  return { fromMonth: 0, toMonth: 0 };
}

export function saveZohoFeeSyncLockPeriod(
  year: number,
  fromMonth: number,
  toMonth: number,
): ZohoFeeSyncLockPeriod {
  const next = normalizeZohoFeeSyncLockPeriod(fromMonth, toMonth);
  if (typeof window === "undefined") return next;
  try {
    if (!next.fromMonth || !next.toMonth) {
      window.localStorage.removeItem(periodKey(year));
      window.localStorage.removeItem(legacyThroughKey(year));
    } else {
      window.localStorage.setItem(periodKey(year), JSON.stringify(next));
      window.localStorage.removeItem(legacyThroughKey(year));
    }
  } catch {
    // ignore quota / private mode
  }
  return next;
}

export function isZohoFeeMonthLocked(
  month1to12: number,
  lock: ZohoFeeSyncLockPeriod | { fromMonth?: number; toMonth?: number } | null | undefined,
): boolean {
  const m = clampMonth(month1to12);
  if (!m) return false;
  const from = clampMonth(lock?.fromMonth);
  const to = clampMonth(lock?.toMonth);
  if (!from || !to) return false;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return m >= lo && m <= hi;
}

/** @deprecated Prefer loadZohoFeeSyncLockPeriod */
export function loadZohoFeeSyncLockThroughMonth(year: number): number {
  return loadZohoFeeSyncLockPeriod(year).toMonth;
}

/** @deprecated Prefer saveZohoFeeSyncLockPeriod */
export function saveZohoFeeSyncLockThroughMonth(year: number, month: number): void {
  const m = clampMonth(month);
  if (!m) {
    saveZohoFeeSyncLockPeriod(year, 0, 0);
    return;
  }
  saveZohoFeeSyncLockPeriod(year, 1, m);
}
