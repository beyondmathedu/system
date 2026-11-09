/** Tags for `unstable_cache` — invalidate via `/api/revalidate-schedule-cache` or after saves. */
export const SCHEDULE_CACHE_TAG_AGGREGATES = "bm-schedule-aggregates-v1";
export const SCHEDULE_CACHE_TAG_DAY_TIMETABLE = "bm-day-timetable-v2";
export const SCHEDULE_CACHE_TAG_HOME = "bm-home-dashboard-v2";
export const SCHEDULE_CACHE_TAG_STUDENT_PROGRESS = "bm-student-progress-v1";
export const SCHEDULE_CACHE_TAG_CLASSROOMS = "bm-classrooms-v1";
/** Bump when fee paid rows are corrected out-of-band so SSR bootstrap cannot keep stale Tuition Paid. */
export const SCHEDULE_CACHE_TAG_FEE_RECORD = "bm-fee-record-v4";

/**
 * Scoped invalidation so a lesson save does not also drop fee / progress / classroom caches.
 * Reading paths stay identical; only which tags are purged after a write changes.
 */
export type ScheduleCacheScope =
  | "schedule"
  | "fee"
  | "classrooms"
  | "progress"
  | "all";

export const SCHEDULE_CACHE_SCOPE_TAGS: Record<ScheduleCacheScope, readonly string[]> = {
  schedule: [
    SCHEDULE_CACHE_TAG_AGGREGATES,
    SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
    SCHEDULE_CACHE_TAG_HOME,
  ],
  fee: [SCHEDULE_CACHE_TAG_FEE_RECORD, SCHEDULE_CACHE_TAG_DAY_TIMETABLE],
  classrooms: [
    SCHEDULE_CACHE_TAG_CLASSROOMS,
    SCHEDULE_CACHE_TAG_AGGREGATES,
    SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
    SCHEDULE_CACHE_TAG_HOME,
  ],
  progress: [SCHEDULE_CACHE_TAG_STUDENT_PROGRESS],
  all: [
    SCHEDULE_CACHE_TAG_AGGREGATES,
    SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
    SCHEDULE_CACHE_TAG_HOME,
    SCHEDULE_CACHE_TAG_STUDENT_PROGRESS,
    SCHEDULE_CACHE_TAG_CLASSROOMS,
    SCHEDULE_CACHE_TAG_FEE_RECORD,
  ],
};

export function resolveScheduleCacheTags(scope?: ScheduleCacheScope | null): readonly string[] {
  if (!scope) return SCHEDULE_CACHE_SCOPE_TAGS.all;
  return SCHEDULE_CACHE_SCOPE_TAGS[scope] ?? SCHEDULE_CACHE_SCOPE_TAGS.all;
}
