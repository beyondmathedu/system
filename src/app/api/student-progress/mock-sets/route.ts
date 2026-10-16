import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { normalizeMockSetLabels, normalizeMockYearLabels } from "@/lib/studentProgressMockSets";
import {
  loadProgressMockSets,
  saveProgressMockSets,
  saveProgressMockYears,
} from "@/lib/studentProgressMockSets.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin" && viewer.role !== "tutor" && viewer.role !== "student") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await loadProgressMockSets();
  return NextResponse.json({
    ok: true,
    labels: result.labels,
    years: result.years,
    tableMissing: Boolean(result.tableMissing),
  });
}

export async function PUT(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId || viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { labels?: unknown; years?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (body.years !== undefined) {
    const years = normalizeMockYearLabels(body.years);
    const result = await saveProgressMockYears(years);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "Save failed", tableMissing: result.tableMissing },
        { status: result.tableMissing ? 503 : 400 },
      );
    }
    return NextResponse.json({ ok: true, years: result.years ?? years });
  }

  const labels = normalizeMockSetLabels(body.labels);
  const result = await saveProgressMockSets(labels);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Save failed", tableMissing: result.tableMissing },
      { status: result.tableMissing ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, labels: result.labels ?? labels });
}
