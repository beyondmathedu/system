import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { defaultDailyTimetablePath, getTutorLandingPath, isTutorViewer } from "@/lib/tutorRoomAccess";

export default async function HomePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");
  if (isTutorViewer(viewer)) {
    redirect(getTutorLandingPath(viewer) ?? defaultDailyTimetablePath());
  }
  redirect("/home");
}
