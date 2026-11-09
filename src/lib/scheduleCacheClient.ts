/**
 * Client-side hook: server caches (room / tutor / day timetables) are purged via Route Handler.
 * Safe to call from browser after Supabase writes; no-op on server.
 * Debounced so rapid saves coalesce into one revalidate round-trip.
 *
 * Prefer a {@link ScheduleCacheScope} so lesson saves do not wipe fee/progress/classroom caches.
 */
import type { ScheduleCacheScope } from "@/lib/scheduleCacheTags";

const REVALIDATE_DEBOUNCE_MS = 400;
let revalidateTimer: number | null = null;
let pendingScope: ScheduleCacheScope = "schedule";
let inFlightRevalidation: Promise<void> | null = null;

function mergeScopes(a: ScheduleCacheScope, b: ScheduleCacheScope): ScheduleCacheScope {
  if (a === "all" || b === "all") return "all";
  if (a === b) return a;
  // Mixed write kinds in one debounce window → full purge once.
  return "all";
}

function postRevalidateScheduleCache(scope: ScheduleCacheScope): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inFlightRevalidation) return inFlightRevalidation;

  inFlightRevalidation = fetch("/api/revalidate-schedule-cache", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope }),
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

export function notifyScheduleCachesStale(scope: ScheduleCacheScope = "schedule"): void {
  if (typeof window === "undefined") return;
  pendingScope = revalidateTimer != null ? mergeScopes(pendingScope, scope) : scope;
  if (revalidateTimer != null) window.clearTimeout(revalidateTimer);
  revalidateTimer = window.setTimeout(() => {
    revalidateTimer = null;
    const toRun = pendingScope;
    pendingScope = "schedule";
    void postRevalidateScheduleCache(toRun);
  }, REVALIDATE_DEBOUNCE_MS);
}

/** Cancel debounced revalidation and run it now (e.g. before in-app navigation). */
export function primeScheduleCacheRevalidationOnNavigate(): void {
  if (typeof window === "undefined") return;
  if (revalidateTimer == null) return;
  window.clearTimeout(revalidateTimer);
  revalidateTimer = null;
  const toRun = pendingScope;
  pendingScope = "schedule";
  void postRevalidateScheduleCache(toRun);
}

/** Flush pending cache revalidation and await the round-trip. */
export async function revalidateScheduleCachesNow(
  scope: ScheduleCacheScope = "schedule",
): Promise<void> {
  if (typeof window === "undefined") return;
  if (revalidateTimer != null) {
    window.clearTimeout(revalidateTimer);
    revalidateTimer = null;
    scope = mergeScopes(pendingScope, scope);
    pendingScope = "schedule";
  }
  await postRevalidateScheduleCache(scope);
}

/** Flush pending cache revalidation (e.g. before leaving the page). */
export function flushScheduleCacheRevalidation(): void {
  void revalidateScheduleCachesNow("all");
}
