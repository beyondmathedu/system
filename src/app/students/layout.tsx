import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import { isSharedIpadTutorViewer } from "@/lib/tutorRoomAccess";
import { normalizeStudentId } from "@/lib/studentId";

export default async function StudentsSectionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id?: string }>;
}) {
  const viewer = await getViewerContext();
  const routeParams = await params;
  if (!viewer.userId) redirect("/login?next=/students");
  if (isSharedIpadTutorViewer(viewer)) return children;
  if (viewer.role === "student") {
    const ownStudentId = normalizeStudentId(viewer.studentId ?? "");
    if (!ownStudentId) redirect("/login");
    const pathStudentId = normalizeStudentId(String(routeParams?.id ?? ""));
    if (pathStudentId && pathStudentId === ownStudentId) return children;
    redirect(`/students/${encodeURIComponent(ownStudentId)}/lessons/2026`);
  }
  redirectTutorAwayFromAdminPages(viewer);
  if (viewer.role !== "admin") redirect("/login");
  return children;
}
