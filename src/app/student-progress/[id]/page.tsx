import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import { normalizeStudentId } from "@/lib/studentId";
import StudentProgressByIdClient from "./StudentProgressByIdClient";

type PageProps = { params: Promise<{ id: string }> };

export default async function StudentProgressByIdPage({ params }: PageProps) {
  const viewer = await getViewerContext();
  const { id } = await params;
  const studentId = normalizeStudentId(id);
  if (!viewer.userId) {
    redirect(`/login?next=${encodeURIComponent(`/student-progress/${id}`)}`);
  }
  redirectTutorAwayFromAdminPages(viewer);
  if (viewer.role === "student") {
    const ownId = normalizeStudentId(viewer.studentId ?? "");
    if (!ownId) redirect("/login");
    if (studentId !== ownId) redirect(`/student-progress/${encodeURIComponent(ownId)}`);
  }
  const navViewer = await buildAppTopNavViewer(viewer);
  const readOnly = viewer.role === "student";
  return <StudentProgressByIdClient navViewer={navViewer} readOnly={readOnly} />;
}
