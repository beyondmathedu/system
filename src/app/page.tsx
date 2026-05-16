import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { getTutorLandingPath, isSharedIpadTutorViewer, isTutorViewer } from "@/lib/tutorRoomAccess";

export default async function HomePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");
  if (isSharedIpadTutorViewer(viewer)) {
    redirect("/home");
  }
  if (isTutorViewer(viewer)) {
    redirect(getTutorLandingPath(viewer) ?? "/rooms");
  }
  redirect("/home");
}
