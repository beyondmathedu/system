/** Browser checkpoint for resumable Zoho fee sync (Fee Record page). */

export const ZOHO_DAILY_DETAIL_QUOTA = 1000;

export type ZohoSyncCheckpointStatus =
  | "in_progress"
  | "rate_limited"
  | "error"
  | "timeout"
  | "complete";

export type ZohoSyncCheckpoint = {
  year: number;
  detailOffset: number;
  matchedTotal: number;
  detailCallsUsed: number;
  batchesDone: number;
  totalSynced: number;
  totalFetched: number;
  totalUnmatched: number;
  status: ZohoSyncCheckpointStatus;
  updatedAt: string;
  lastError?: string;
};

export type ZohoSyncDayMeta = {
  /** Asia/Hong_Kong calendar date YYYY-MM-DD */
  dateKey: string;
  /** Approximate Zoho detail API calls used today (client-tracked). */
  detailCallsUsed: number;
  lastFullSuccessAt?: string;
  lastFullSuccessYear?: number;
};

function checkpointKey(year: number): string {
  return `zoho-fee-sync-checkpoint:${year}`;
}

const DAY_META_KEY = "zoho-fee-sync-day-meta";

export function hkDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(d);
}

export function formatHkTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(t));
}

export function loadZohoSyncCheckpoint(year: number): ZohoSyncCheckpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(checkpointKey(year));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ZohoSyncCheckpoint;
    if (!parsed || parsed.year !== year) return null;
    if (parsed.status === "complete") return null;
    if (!Number.isFinite(parsed.detailOffset) || parsed.detailOffset < 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveZohoSyncCheckpoint(cp: ZohoSyncCheckpoint): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(checkpointKey(cp.year), JSON.stringify(cp));
  } catch {
    // ignore quota / private mode
  }
}

export function clearZohoSyncCheckpoint(year: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(checkpointKey(year));
  } catch {
    // ignore
  }
}

export function loadZohoSyncDayMeta(): ZohoSyncDayMeta {
  const today = hkDateKey();
  if (typeof window === "undefined") {
    return { dateKey: today, detailCallsUsed: 0 };
  }
  try {
    const raw = window.localStorage.getItem(DAY_META_KEY);
    if (!raw) return { dateKey: today, detailCallsUsed: 0 };
    const parsed = JSON.parse(raw) as ZohoSyncDayMeta;
    if (!parsed || parsed.dateKey !== today) {
      return { dateKey: today, detailCallsUsed: 0 };
    }
    return {
      dateKey: today,
      detailCallsUsed: Math.max(0, Number(parsed.detailCallsUsed) || 0),
      lastFullSuccessAt: parsed.lastFullSuccessAt,
      lastFullSuccessYear: parsed.lastFullSuccessYear,
    };
  } catch {
    return { dateKey: today, detailCallsUsed: 0 };
  }
}

export function saveZohoSyncDayMeta(meta: ZohoSyncDayMeta): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DAY_META_KEY, JSON.stringify(meta));
  } catch {
    // ignore
  }
}

export function addZohoDayDetailCalls(n: number): ZohoSyncDayMeta {
  const meta = loadZohoSyncDayMeta();
  const next: ZohoSyncDayMeta = {
    ...meta,
    dateKey: hkDateKey(),
    detailCallsUsed: meta.detailCallsUsed + Math.max(0, Math.floor(n) || 0),
  };
  saveZohoSyncDayMeta(next);
  return next;
}

export function markZohoFullSyncSuccess(year: number): ZohoSyncDayMeta {
  const meta = loadZohoSyncDayMeta();
  const next: ZohoSyncDayMeta = {
    ...meta,
    dateKey: hkDateKey(),
    lastFullSuccessAt: new Date().toISOString(),
    lastFullSuccessYear: year,
  };
  saveZohoSyncDayMeta(next);
  clearZohoSyncCheckpoint(year);
  return next;
}

export function zohoSyncProgressPercent(offset: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((Math.min(offset, total) / total) * 100)));
}
