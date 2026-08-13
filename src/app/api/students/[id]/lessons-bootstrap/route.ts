import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { defaultLessonYear, parseLessonYear } from "@/lib/lessonCalendar";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { loadStudentLessonsBootstrap } from "@/lib/lessonDataServer";
import { TUTOR_SHARED_IPAD_EMAIL } from "@/lib/tutorConstants";
import { normalizeStudentId } from "@/lib/studentId";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** One round-trip for student year lesson page initial data. */
export async function GET(request: NextRequest, context: RouteContext) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const studentId = normalizeStudentId(String(rawId ?? ""));
  if (!studentId) {
    return NextResponse.json({ ok: false, error: "Invalid student id" }, { status: 400 });
  }

  const year = parseLessonYear(
    request.nextUrl.searchParams.get("year"),
    defaultLessonYear(),
  );

  const isSharedIpad = viewer.isSharedIpadTutor;
  const role = viewer.role;

  if (role === "student") {
    const ownId = normalizeStudentId(String(viewer.studentId ?? ""));
    if (ownId && ownId !== studentId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }
  if (!role && !isSharedIpad) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const payload = await loadStudentLessonsBootstrap(supabase, studentId, year);
    const readOnly =
      isSharedIpad ||
      role === "tutor" ||
      role === "student" ||
      String(viewer.email ?? "").trim().toLowerCase() === TUTOR_SHARED_IPAD_EMAIL.toLowerCase();

    return NextResponse.json({
      ok: true,
      readOnly,
      ...payload,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load lessons bootstrap";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
