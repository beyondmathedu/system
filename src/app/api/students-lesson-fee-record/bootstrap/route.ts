import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { loadFeeRecordBootstrapCached } from "@/lib/lessonDataServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin fee sheet: one HTTP round-trip for students + lesson/fee bulk data. */
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const sheetYear = Number(request.nextUrl.searchParams.get("year") ?? "2026");
  const sheetMonth = Number(request.nextUrl.searchParams.get("month") ?? "1");
  if (!Number.isFinite(sheetYear) || !Number.isFinite(sheetMonth) || sheetMonth < 1 || sheetMonth > 12) {
    return NextResponse.json({ ok: false, error: "Invalid year or month" }, { status: 400 });
  }

  try {
    const payload = await loadFeeRecordBootstrapCached(sheetYear, sheetMonth);
    return NextResponse.json({ ok: true, ...payload });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load fee record data";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
