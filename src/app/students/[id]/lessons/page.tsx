import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { defaultLessonYear } from "@/lib/lessonCalendar";
import { loadStudentLessonsBootstrap } from "@/lib/lessonDataServer";
import { normalizeStudentId } from "@/lib/studentId";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { TUTOR_SHARED_IPAD_EMAIL } from "@/lib/tutorConstants";
import { defaultDailyTimetablePath } from "@/lib/tutorRoomAccess";
import StudentLessonsHubClient from "./StudentLessonsHubClient";

type PageProps = { params: Promise<{ id: string }> };

export default async function StudentLessonsHubPage({ params }: PageProps) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    redirect("/login?next=/students");
  }

  const { id: rawId } = await params;
  const studentId = normalizeStudentId(String(rawId ?? ""));
  if (!studentId) {
    redirect("/students");
  }

  if (viewer.isSharedIpadTutor) {
    redirect(defaultDailyTimetablePath());
  }

  if (viewer.role === "student") {
    const ownId = normalizeStudentId(String(viewer.studentId ?? ""));
    if (ownId && ownId !== studentId) {
      redirect(`/students/${encodeURIComponent(ownId)}/lessons`);
    }
  }

  const hubYear = defaultLessonYear();
  const supabase = await createSupabaseServerClient();
  const initialBootstrap = await loadStudentLessonsBootstrap(supabase, studentId, hubYear);
  const initialReadOnly =
    viewer.role === "tutor" ||
    viewer.role === "student" ||
    String(viewer.email ?? "").trim().toLowerCase() === TUTOR_SHARED_IPAD_EMAIL.toLowerCase();
  const navViewer = await buildAppTopNavViewer(viewer);

  return (
    <StudentLessonsHubClient
      studentId={studentId}
      hubYear={hubYear}
      initialBootstrap={initialBootstrap}
      initialReadOnly={initialReadOnly}
      navViewer={navViewer}
    />
  );
}
