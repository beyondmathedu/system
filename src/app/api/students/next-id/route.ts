import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchNextStudentIdFromDbServer } from "@/lib/studentsListServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const nextId = await fetchNextStudentIdFromDbServer(supabase);
    return NextResponse.json({ ok: true, nextId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to compute next student id";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
