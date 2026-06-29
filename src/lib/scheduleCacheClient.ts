/**
 * Client-side hook: server caches (room / tutor / day timetables) are purged via Route Handler.
 * Safe to call from browser after Supabase writes; no-op on server.
 * Debounced so rapid saves coalesce into one revalidate round-trip.
 */
const REVALIDATE_DEBOUNCE_MS = 400;
let revalidateTimer: number | null = null;
let inFlightRevalidation: Promise<void> | null = null;

function postRevalidateScheduleCache(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inFlightRevalidation) return inFlightRevalidation;

  inFlightRevalidation = fetch("/api/revalidate-schedule-cache", {
    method: "POST",
    credentials: "same-origin",
  })
    .then(() => {})
    .catch(() => {})
    .finally(() => {
      inFlightRevalidation = null;
    });

  return inFlightRevalidation;
}

export function hasPendingScheduleCacheRevalidation(): boolean {
  return revalidateTimer != null;
}

export function notifyScheduleCachesStale(): void {
  if (typeof window === "undefined") return;
  if (revalidateTimer != null) window.clearTimeout(revalidateTimer);
  revalidateTimer = window.setTimeout(() => {
    revalidateTimer = null;
    void postRevalidateScheduleCache();
  }, REVALIDATE_DEBOUNCE_MS);
}

/** Cancel debounced revalidation and run it now (e.g. before in-app navigation). */
export function primeScheduleCacheRevalidationOnNavigate(): void {
  if (typeof window === "undefined") return;
  if (revalidateTimer == null) return;
  window.clearTimeout(revalidateTimer);
  revalidateTimer = null;
  void postRevalidateScheduleCache();
}

/** Flush pending cache revalidation and await the round-trip. */
export async function revalidateScheduleCachesNow(): Promise<void> {
  if (typeof window === "undefined") return;
  if (revalidateTimer != null) {
    window.clearTimeout(revalidateTimer);
    revalidateTimer = null;
  }
  await postRevalidateScheduleCache();
}

/** Flush pending cache revalidation (e.g. before leaving the page). */
export function flushScheduleCacheRevalidation(): void {
  void revalidateScheduleCachesNow();
}
