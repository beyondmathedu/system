import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";

export default async function HomePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");
  if (viewer.role === "student" && viewer.studentId) {
    redirect(`/students/${encodeURIComponent(viewer.studentId)}/lessons/2026`);
  }
  if (viewer.role === "tutor") redirect("/daily-time-table");
  redirect("/tutor-monthly-lesson-record");
}
