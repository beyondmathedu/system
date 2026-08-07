import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { studentLessonsYearPath } from "@/lib/lessonCalendar";
import { loadStudentLessonsBootstrap } from "@/lib/lessonDataServer";
import { normalizeStudentId } from "@/lib/studentId";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { TUTOR_SHARED_IPAD_EMAIL } from "@/lib/tutorConstants";
import { StudentLessonsYearPage } from "../StudentLessonsYearPage";

type PageProps = { params: Promise<{ id: string }> };

export default async function StudentLessons2026Page({ params }: PageProps) {
  const viewer = await getViewerContext();
  const { id: rawId } = await params;
  const studentId = normalizeStudentId(String(rawId ?? ""));
  const targetYear = 2026;

  if (!viewer.userId) {
    redirect(`/login?next=${encodeURIComponent(`/students/${studentId}/lessons/${targetYear}`)}`);
  }
  if (!studentId) {
    redirect("/students");
  }
  if (viewer.role === "student") {
    const ownId = normalizeStudentId(String(viewer.studentId ?? ""));
    if (ownId && ownId !== studentId) {
      redirect(studentLessonsYearPath(ownId));
    }
  }

  const supabase = await createSupabaseServerClient();
  const initialBootstrap = await loadStudentLessonsBootstrap(supabase, studentId, targetYear);
  const initialReadOnly =
    viewer.isSharedIpadTutor ||
    viewer.role === "tutor" ||
    String(viewer.email ?? "").trim().toLowerCase() === TUTOR_SHARED_IPAD_EMAIL.toLowerCase();

  const navViewer = await buildAppTopNavViewer(viewer);

  return (
    <StudentLessonsYearPage
      targetYear={targetYear}
      initialBootstrap={initialBootstrap}
      initialReadOnly={initialReadOnly}
      navViewer={navViewer}
    />
  );
}
