import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { getStudentPortalStatusBatch } from "@/lib/studentPortalProvision.server";
import { normalizeStudentId } from "@/lib/studentId";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const idsRaw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsRaw
    .split(",")
    .map((id) => normalizeStudentId(id.trim()))
    .filter(Boolean)
    .slice(0, 200);

  try {
    const statusById = await getStudentPortalStatusBatch(ids);
    return NextResponse.json({ ok: true, statusById });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load portal status";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
