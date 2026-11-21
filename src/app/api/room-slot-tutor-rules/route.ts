import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import {
  SCHEDULE_CACHE_TAG_AGGREGATES,
  SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
} from "@/lib/scheduleCacheTags";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { upsertRoomSlotTutorRule } from "@/lib/roomSlotTutorRules";

export const dynamic = "force-dynamic";

/**
 * Persist default tutor for a recurring room + weekday + time slot.
 * Classroom tutor dropdowns call this so assignments survive beyond one date's overrides.
 */
export async function POST(request: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin" && viewer.role !== "tutor") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body as {
    room?: string;
    weekday?: string;
    time?: string;
    tutorName?: string;
    effectiveDate?: string;
  };
  const room = String(raw.room ?? "").trim();
  const weekday = String(raw.weekday ?? "").trim();
  const time = String(raw.time ?? "").trim();
  const tutorName = String(raw.tutorName ?? "").trim();
  const effectiveDate = String(raw.effectiveDate ?? "").trim();

  if (!room || !weekday || !time || !tutorName || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return NextResponse.json({ ok: false, error: "invalid_slot" }, { status: 400 });
  }
  if (tutorName === "TBD" || tutorName === "待定" || tutorName === "—") {
    return NextResponse.json({ ok: false, error: "invalid_tutor" }, { status: 400 });
  }

  try {
    await upsertRoomSlotTutorRule(getSupabaseAdmin(), {
      room,
      weekday,
      time,
      tutor_name: tutorName,
      effective_date: effectiveDate,
    });
    // Room pages use AGGREGATES; slot-rule list uses DAY_TIMETABLE.
    revalidateTag(SCHEDULE_CACHE_TAG_AGGREGATES, "max");
    revalidateTag(SCHEDULE_CACHE_TAG_DAY_TIMETABLE, "max");
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
