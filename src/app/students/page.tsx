import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { studentLessonsYearPath } from "@/lib/lessonCalendar";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import { normalizeStudentId } from "@/lib/studentId";
import StudentsPageEntry from "./StudentsPageEntry";

export default async function StudentsPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/students");
  redirectTutorAwayFromAdminPages(viewer);
  if (viewer.role === "student") {
    const sid = normalizeStudentId(viewer.studentId ?? "");
    if (sid) redirect(studentLessonsYearPath(sid));
    redirect("/login");
  }
  const navViewer = await buildAppTopNavViewer(viewer);
  return <StudentsPageEntry navViewer={navViewer} />;
}
