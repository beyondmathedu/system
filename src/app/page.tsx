import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { defaultDailyTimetablePath, getTutorLandingPath, isTutorViewer } from "@/lib/tutorRoomAccess";
import { studentPortalHomePath } from "@/lib/studentPortalAccess";
import { normalizeStudentId } from "@/lib/studentId";

export default async function HomePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");
  if (viewer.role === "student") {
    const sid = normalizeStudentId(viewer.studentId ?? "");
    if (sid) redirect(studentPortalHomePath(sid));
    redirect("/login");
  }
  if (isTutorViewer(viewer)) {
    redirect(getTutorLandingPath(viewer) ?? defaultDailyTimetablePath());
  }
  redirect("/home");
}
