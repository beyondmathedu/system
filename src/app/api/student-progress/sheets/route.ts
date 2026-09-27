import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { fetchStudentProgressForLevel } from "@/lib/studentProgressWorkbook.server";

export const dynamic = "force-dynamic";

function parseLevel(raw: string | null): number | null {
  const level = Number(raw);
  if (!Number.isFinite(level) || level < 1 || level > 6) return null;
  return Math.trunc(level);
}

/** Cached JSON sheets for Student Progress (replaces client-side xlsx parse). */
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const level = parseLevel(request.nextUrl.searchParams.get("level"));
  if (level === null) {
    return NextResponse.json({ ok: false, error: "Invalid level (1–6)" }, { status: 400 });
  }

  const takesM1 = request.nextUrl.searchParams.get("m1") === "1";
  const takesM2 = request.nextUrl.searchParams.get("m2") === "1";

  try {
    const payload = await fetchStudentProgressForLevel(level, { takesM1, takesM2 });
    return NextResponse.json({
      ok: true,
      level,
      takesM1,
      takesM2,
      sheets: payload.sheets,
      cutOffSheet: payload.cutOffSheet,
      yearGradeThresholds: payload.yearGradeThresholds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load progress workbook";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
