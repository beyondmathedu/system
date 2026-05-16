import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { isSharedIpadTutorViewer, isTutorViewer } from "@/lib/tutorRoomAccess";
import RoomsAdminClient from "./RoomsAdminClient";
import TutorRoomsPortal from "./TutorRoomsPortal";

export default async function RoomsIndexPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/rooms");
  if (viewer.role === "student") redirect("/login");

  if (isSharedIpadTutorViewer(viewer)) {
    redirect("/home");
  }
  if (isTutorViewer(viewer)) {
    return <TutorRoomsPortal />;
  }

  if (viewer.role !== "admin") redirect("/login");

  return <RoomsAdminClient />;
}
