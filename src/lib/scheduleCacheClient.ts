/**
 * Client-side hook: server caches (room / tutor / day timetables) are purged via Route Handler.
 * Safe to call from browser after Supabase writes; no-op on server.
 */
export function notifyScheduleCachesStale(): void {
  if (typeof window === "undefined") return;
  void fetch("/api/revalidate-schedule-cache", {
    method: "POST",
    credentials: "same-origin",
  }).catch(() => {});
}
