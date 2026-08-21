import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { deleteStudentsAndAuthAccounts } from "@/lib/studentPortalProvision.server";
import { normalizeStudentId } from "@/lib/studentId";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: { ids?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const ids = (Array.isArray(body.ids) ? body.ids : [])
    .map((id) => normalizeStudentId(String(id ?? "")))
    .filter(Boolean);

  if (!ids.length) {
    return NextResponse.json({ ok: false, error: "No student ids" }, { status: 400 });
  }

  try {
    const result = await deleteStudentsAndAuthAccounts(ids);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to delete students";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
