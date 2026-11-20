import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { normalizeStudentId } from "@/lib/studentId";

export const dynamic = "force-dynamic";

/** Phone entry: send each role to the right lightweight page. */
export default async function MobileHomePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/m");
  if (viewer.role === "student" && viewer.studentId) {
    redirect(`/m/my-schedule`);
  }
  if (viewer.role === "tutor" || viewer.role === "admin") {
    redirect("/m/attendance");
  }
  if (viewer.studentId) {
    redirect(`/students/${encodeURIComponent(normalizeStudentId(viewer.studentId))}/lessons`);
  }
  redirect("/login");
}
