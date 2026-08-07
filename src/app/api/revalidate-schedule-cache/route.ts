import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import {
  SCHEDULE_CACHE_TAG_AGGREGATES,
  SCHEDULE_CACHE_TAG_CLASSROOMS,
  SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
  SCHEDULE_CACHE_TAG_FEE_RECORD,
  SCHEDULE_CACHE_TAG_HOME,
  SCHEDULE_CACHE_TAG_STUDENT_PROGRESS,
} from "@/lib/scheduleCacheTags";

/**
 * Purges server-side caches for room schedule, tutor monthly rows, and day/regular timetables.
 * Call after editing lessons (or use the automatic hooks in studentLessonStorage).
 */
export async function POST() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin" && viewer.role !== "tutor") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  revalidateTag(SCHEDULE_CACHE_TAG_AGGREGATES, "max");
  revalidateTag(SCHEDULE_CACHE_TAG_DAY_TIMETABLE, "max");
  revalidateTag(SCHEDULE_CACHE_TAG_HOME, "max");
  revalidateTag(SCHEDULE_CACHE_TAG_STUDENT_PROGRESS, "max");
  revalidateTag(SCHEDULE_CACHE_TAG_CLASSROOMS, "max");
  revalidateTag(SCHEDULE_CACHE_TAG_FEE_RECORD, "max");

  return NextResponse.json({ ok: true });
}
