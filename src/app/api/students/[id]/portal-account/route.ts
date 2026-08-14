import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import {
  getStudentPortalStatusBatch,
  provisionStudentPortalAccount,
  resetStudentPortalPassword,
  syncStudentPortalEmail,
} from "@/lib/studentPortalProvision.server";
import { normalizeStudentId } from "@/lib/studentId";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type PortalAction = "provision" | "reset-password" | "sync-email";

export async function POST(request: NextRequest, context: RouteContext) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await context.params;
  const studentId = normalizeStudentId(String(rawId ?? ""));
  if (!studentId) {
    return NextResponse.json({ ok: false, error: "Invalid student id" }, { status: 400 });
  }

  let body: { action?: PortalAction; password?: string; studentIdLoginOnly?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const action = body.action;
  if (action !== "provision" && action !== "reset-password" && action !== "sync-email") {
    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }

  const passwordOverride = String(body.password ?? "").trim() || undefined;
  const studentIdLoginOnly = Boolean(body.studentIdLoginOnly);

  try {
    const result =
      action === "provision"
        ? await provisionStudentPortalAccount(studentId, { passwordOverride, studentIdLoginOnly })
        : action === "reset-password"
          ? await resetStudentPortalPassword(studentId, { passwordOverride })
          : await syncStudentPortalEmail(studentId);

    const statusById = await getStudentPortalStatusBatch([studentId]);
    return NextResponse.json({
      ok: true,
      result,
      status: statusById[studentId] ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Portal account action failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
