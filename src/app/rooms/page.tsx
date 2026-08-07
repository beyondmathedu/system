import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { defaultDailyTimetablePath, isSharedIpadTutorViewer, isTutorViewer } from "@/lib/tutorRoomAccess";
import RoomsAdminClient from "./RoomsAdminClient";

export default async function RoomsIndexPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/rooms");
  if (viewer.role === "student") redirect("/login");

  if (isSharedIpadTutorViewer(viewer) || isTutorViewer(viewer)) {
    redirect(defaultDailyTimetablePath());
  }

  if (viewer.role !== "admin") redirect("/login");

  const navViewer = await buildAppTopNavViewer(viewer);
  return <RoomsAdminClient navViewer={navViewer} />;
}
