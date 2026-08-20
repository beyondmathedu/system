import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { getTutorAuthStatusBatch, resetTutorPassword } from "@/lib/tutorAuthProvision.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type TutorAuthAction = "reset-password";

export async function POST(request: NextRequest, context: RouteContext) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await context.params;
  const tutorId = String(rawId ?? "").trim();
  if (!tutorId) {
    return NextResponse.json({ ok: false, error: "Invalid tutor id" }, { status: 400 });
  }

  let body: { action?: TutorAuthAction; password?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action !== "reset-password") {
    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }

  try {
    const result = await resetTutorPassword(tutorId, String(body.password ?? ""));
    const statusById = await getTutorAuthStatusBatch([tutorId]);
    return NextResponse.json({
      ok: true,
      result,
      status: statusById[tutorId] ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Tutor auth action failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
