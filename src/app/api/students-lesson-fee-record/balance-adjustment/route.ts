import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { upsertStudentFeeBalanceAdjustmentAdmin } from "@/lib/lessonDataServer";
import {
  SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
  SCHEDULE_CACHE_TAG_FEE_RECORD,
} from "@/lib/scheduleCacheTags";
import { normalizeStudentId } from "@/lib/studentId";

export const dynamic = "force-dynamic";

/** Persist balance adjustment (優惠／調整) and purge fee + day-timetable caches. */
export async function POST(request: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body as { studentId?: string; amount?: number | string; reason?: string };
  const studentId = normalizeStudentId(String(raw.studentId ?? ""));
  if (!studentId) {
    return NextResponse.json({ ok: false, error: "Invalid studentId" }, { status: 400 });
  }

  const amount = Number(raw.amount);
  if (!Number.isFinite(amount)) {
    return NextResponse.json({ ok: false, error: "Invalid amount" }, { status: 400 });
  }
  const reason = String(raw.reason ?? "");

  const result = await upsertStudentFeeBalanceAdjustmentAdmin(studentId, { amount, reason });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Save failed",
        tableMissing: Boolean(result.tableMissing),
      },
      { status: result.tableMissing ? 503 : 500 },
    );
  }

  revalidateTag(SCHEDULE_CACHE_TAG_FEE_RECORD, "max");
  revalidateTag(SCHEDULE_CACHE_TAG_DAY_TIMETABLE, "max");

  return NextResponse.json({ ok: true, studentId, amount, reason });
}
