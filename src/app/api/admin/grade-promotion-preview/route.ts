import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { previewStudentGradePromotion } from "@/lib/previewStudentGradePromotion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin-only read-only preview of Sept grade promotion. */
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const yearRaw = request.nextUrl.searchParams.get("year");
  const year =
    yearRaw && Number.isFinite(Number(yearRaw)) ? Math.trunc(Number(yearRaw)) : null;

  try {
    const preview = await previewStudentGradePromotion({ year });
    return NextResponse.json({ ok: true, preview });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Preview failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
