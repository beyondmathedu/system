import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { normalizeStudentId } from "@/lib/studentId";
import { coerceProgressSelectionMap } from "@/lib/studentProgressSelections";
import {
  loadStudentProgressSelectionsDurable,
  saveStudentProgressSelectionsDurable,
} from "@/lib/studentProgressSelections.server";

export const dynamic = "force-dynamic";

function canAccessStudent(
  viewer: Awaited<ReturnType<typeof getViewerContext>>,
  studentId: string,
): boolean {
  if (!viewer.userId) return false;
  if (viewer.role === "admin" || viewer.role === "tutor") return true;
  if (viewer.role === "student") {
    return normalizeStudentId(viewer.studentId ?? "") === studentId;
  }
  return false;
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext();
  const studentId = normalizeStudentId(request.nextUrl.searchParams.get("studentId") ?? "");
  if (!studentId) {
    return NextResponse.json({ ok: false, error: "Missing studentId" }, { status: 400 });
  }
  if (!canAccessStudent(viewer, studentId)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await loadStudentProgressSelectionsDurable(studentId);
    return NextResponse.json({
      ok: true,
      studentId,
      selections: result.row?.selections ?? {},
      updatedAt: result.row?.updatedAt ?? null,
      backend: result.backend,
      tableMissing: Boolean(result.tableMissing),
      error: result.error ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load progress selections";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const viewer = await getViewerContext();
  let body: { studentId?: unknown; selections?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const studentId = normalizeStudentId(String(body.studentId ?? ""));
  if (!studentId) {
    return NextResponse.json({ ok: false, error: "Missing studentId" }, { status: 400 });
  }
  if (!canAccessStudent(viewer, studentId)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const selections = coerceProgressSelectionMap(body.selections);
  const updatedBy =
    viewer.role === "student"
      ? `student:${studentId}`
      : viewer.email
        ? `${viewer.role}:${viewer.email}`
        : String(viewer.role ?? viewer.userId ?? "");

  try {
    const result = await saveStudentProgressSelectionsDurable({
      studentId,
      selections,
      updatedBy,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "Save failed", tableMissing: result.tableMissing },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      studentId,
      updatedAt: result.updatedAt ?? null,
      backend: result.backend,
      tableMissing: Boolean(result.tableMissing),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save progress selections";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
