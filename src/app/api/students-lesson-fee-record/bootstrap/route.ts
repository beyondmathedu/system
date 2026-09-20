import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import {
  loadFeeRecordBootstrapCached,
  loadFeeRecordMonthDeltaCached,
} from "@/lib/lessonDataServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin fee sheet: full bootstrap, or month delta when part=month (same year core kept client-side). */
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
  const part = String(request.nextUrl.searchParams.get("part") ?? "full").toLowerCase();
  if (!Number.isFinite(sheetYear) || !Number.isFinite(sheetMonth) || sheetMonth < 1 || sheetMonth > 12) {
    return NextResponse.json({ ok: false, error: "Invalid year or month" }, { status: 400 });
  }

  try {
    if (part === "month") {
      const payload = await loadFeeRecordMonthDeltaCached(sheetYear, sheetMonth);
      return NextResponse.json({ ok: true, part: "month", ...payload });
    }
    const payload = await loadFeeRecordBootstrapCached(sheetYear, sheetMonth);
    return NextResponse.json({ ok: true, part: "full", ...payload });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load fee record data";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
