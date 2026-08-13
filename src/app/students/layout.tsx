import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { redirectIfInactiveStudentPortalBlocked } from "@/lib/studentPortalAccess.server";
import { isSharedIpadTutorViewer } from "@/lib/tutorRoomAccess";
import { normalizeStudentId } from "@/lib/studentId";

/** Auth gate for all /students routes. Student id scoping lives in [id]/layout.tsx. */
export default async function StudentsSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/students");
  if (isSharedIpadTutorViewer(viewer)) return children;
  if (viewer.role === "student") {
    if (!normalizeStudentId(viewer.studentId ?? "")) redirect("/login");
    await redirectIfInactiveStudentPortalBlocked(viewer);
    return children;
  }
  if (viewer.role === "tutor") return children;
  if (viewer.role !== "admin") redirect("/login");
  return children;
}
