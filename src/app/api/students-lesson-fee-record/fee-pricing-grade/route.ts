import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { patchStudentMonthlyFeePricingGradeAdmin } from "@/lib/lessonDataServer";
import { SCHEDULE_CACHE_TAG_FEE_RECORD } from "@/lib/scheduleCacheTags";
import { normalizeStudentId } from "@/lib/studentId";

export const dynamic = "force-dynamic";

/** Persist per-month fee_pricing_grade and purge fee-record bootstrap cache. */
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

  const raw = body as {
    studentId?: string;
    year?: number | string;
    month?: number | string;
    feePricingGrade?: string;
    submittedAmount?: number | string;
  };
  const studentId = normalizeStudentId(String(raw.studentId ?? ""));
  const year = Math.floor(Number(raw.year));
  const month = Math.floor(Number(raw.month));
  if (!studentId) {
    return NextResponse.json({ ok: false, error: "Invalid studentId" }, { status: 400 });
  }
  if (!Number.isFinite(year) || month < 1 || month > 12) {
    return NextResponse.json({ ok: false, error: "Invalid year/month" }, { status: 400 });
  }

  const result = await patchStudentMonthlyFeePricingGradeAdmin({
    studentId,
    year,
    month,
    feePricingGrade: String(raw.feePricingGrade ?? ""),
    submittedAmount: Number(raw.submittedAmount) || 0,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Save failed" },
      { status: 500 },
    );
  }

  revalidateTag(SCHEDULE_CACHE_TAG_FEE_RECORD, "max");

  return NextResponse.json({
    ok: true,
    studentId,
    year,
    month,
    feePricingGrade: result.feePricingGrade,
  });
}
