import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { upsertStudentFeeOpeningBalanceAdmin } from "@/lib/lessonDataServer";
import { SCHEDULE_CACHE_TAG_FEE_RECORD } from "@/lib/scheduleCacheTags";
import { normalizeStudentId } from "@/lib/studentId";

export const dynamic = "force-dynamic";

/** Persist opening balance and purge stale fee-record bootstrap cache. */
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

  const raw = body as { studentId?: string; openingBalance?: number | string };
  const studentId = normalizeStudentId(String(raw.studentId ?? ""));
  if (!studentId) {
    return NextResponse.json({ ok: false, error: "Invalid studentId" }, { status: 400 });
  }

  const openingBalance = Number(raw.openingBalance);
  if (!Number.isFinite(openingBalance)) {
    return NextResponse.json({ ok: false, error: "Invalid openingBalance" }, { status: 400 });
  }

  const result = await upsertStudentFeeOpeningBalanceAdmin(studentId, openingBalance);
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

  return NextResponse.json({ ok: true, studentId, openingBalance });
}
