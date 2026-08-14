import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getStudentPortalStatusBatch } from "@/lib/studentPortalProvision.server";
import { listStudentsForPage } from "@/lib/studentsListServer";

export const dynamic = "force-dynamic";

/** Paginated students list for /students hub (avoids loading entire table client-side). */
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const offset = Number(sp.get("offset") ?? "0");
  const limit = Number(sp.get("limit") ?? "80");
  const q = sp.get("q") ?? "";
  const statusRaw = sp.get("status") ?? "active";
  const status =
    statusRaw === "inactive" || statusRaw === "all" ? statusRaw : ("active" as const);
  const kindRaw = sp.get("inactiveKind") ?? "all";
  const inactiveKind =
    kindRaw === "temporary" || kindRaw === "graduated" ? kindRaw : ("all" as const);

  try {
    const supabase = getSupabaseAdmin();
    const result = await listStudentsForPage(supabase, {
      offset,
      limit,
      q,
      status,
      inactiveKind: status === "inactive" ? inactiveKind : "all",
    });
    let portalStatusById = {};
    try {
      portalStatusById = await getStudentPortalStatusBatch(result.rows.map((r) => r.id));
    } catch {
      portalStatusById = {};
    }
    return NextResponse.json({
      ok: true,
      students: result.rows,
      visibility: result.manualInactiveEffectiveById,
      portalStatusById,
      offset,
      limit,
      total: result.total,
      hasMore: result.hasMore,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load students";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
