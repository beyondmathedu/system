import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { getStudentPortalAccessState } from "@/lib/studentPortalAccess.server";
import { normalizeStudentId } from "@/lib/studentId";

export async function GET() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "student") {
    return NextResponse.json({ ok: true, allowed: true, role: viewer.role });
  }

  const studentId = normalizeStudentId(viewer.studentId ?? "");
  if (!studentId) {
    return NextResponse.json({ ok: true, allowed: false, reason: "missing_student_id" });
  }

  const access = await getStudentPortalAccessState(studentId);
  return NextResponse.json({
    ok: true,
    allowed: access.allowed,
    reactivateDate: access.reactivateDate,
    reason: access.allowed ? null : "inactive",
  });
}
