/** Process-local cache so Sync batches do not re-list the whole year every time. */

export type CachedZohoReceipt = Record<string, unknown>;

type ListCacheEntry = {
  receipts: CachedZohoReceipt[];
  expiresAtMs: number;
};

const listCache = new Map<string, ListCacheEntry>();
const LIST_TTL_MS = 45 * 60 * 1000;

export function zohoReceiptListCacheKey(
  orgId: string,
  dateStart: string,
  dateEnd: string,
): string {
  return `${orgId}|${dateStart}|${dateEnd}`;
}

export function getCachedZohoReceiptList(key: string): CachedZohoReceipt[] | null {
  const hit = listCache.get(key);
  if (!hit) return null;
  if (hit.expiresAtMs <= Date.now()) {
    listCache.delete(key);
    return null;
  }
  return hit.receipts;
}

export function setCachedZohoReceiptList(key: string, receipts: CachedZohoReceipt[]): void {
  listCache.set(key, {
    receipts,
    expiresAtMs: Date.now() + LIST_TTL_MS,
  });
}

export function clearZohoReceiptListCache(): void {
  listCache.clear();
}
