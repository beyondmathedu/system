import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import {
  resolveScheduleCacheTags,
  type ScheduleCacheScope,
} from "@/lib/scheduleCacheTags";

const VALID_SCOPES = new Set<ScheduleCacheScope>([
  "schedule",
  "fee",
  "classrooms",
  "progress",
  "all",
]);

/**
 * Purges server-side caches for room schedule, tutor monthly rows, and day/regular timetables.
 * Call after editing lessons (or use the automatic hooks in studentLessonStorage).
 *
 * Optional JSON body `{ "scope": "schedule" | "fee" | "classrooms" | "progress" | "all" }`.
 * Defaults to `all` when omitted (backward compatible with older clients).
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin" && viewer.role !== "tutor") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let scope: ScheduleCacheScope = "all";
  try {
    const body = (await request.json()) as { scope?: unknown };
    const raw = String(body?.scope ?? "").trim() as ScheduleCacheScope;
    if (VALID_SCOPES.has(raw)) scope = raw;
  } catch {
    // Empty / non-JSON body → full purge (legacy callers).
    scope = "all";
  }

  for (const tag of resolveScheduleCacheTags(scope)) {
    revalidateTag(tag, "max");
  }

  return NextResponse.json({ ok: true, scope });
}
