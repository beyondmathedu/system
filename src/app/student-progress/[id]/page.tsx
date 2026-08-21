import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectIfInactiveStudentPortalBlocked } from "@/lib/studentPortalAccess.server";
import { normalizeStudentId } from "@/lib/studentId";
import { isTutorViewer } from "@/lib/tutorRoomAccess";
import StudentProgressByIdClient from "./StudentProgressByIdClient";

type PageProps = { params: Promise<{ id: string }> };

export default async function StudentProgressByIdPage({ params }: PageProps) {
  const viewer = await getViewerContext();
  const { id } = await params;
  const studentId = normalizeStudentId(id);
  if (!viewer.userId) {
    redirect(`/login?next=${encodeURIComponent(`/student-progress/${id}`)}`);
  }
  // Tutors / shared iPad may open a single student's progress (read-only) from Lesson Record.
  // The list page `/student-progress` remains admin-only.
  if (viewer.role === "student") {
    await redirectIfInactiveStudentPortalBlocked(viewer);
    const ownId = normalizeStudentId(viewer.studentId ?? "");
    if (!ownId) redirect("/login");
    if (studentId !== ownId) redirect(`/student-progress/${encodeURIComponent(ownId)}`);
  }
  const navViewer = await buildAppTopNavViewer(viewer);
  const readOnly = viewer.role === "student" || isTutorViewer(viewer);
  return <StudentProgressByIdClient navViewer={navViewer} readOnly={readOnly} />;
}
