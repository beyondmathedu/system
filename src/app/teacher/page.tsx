import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import TeacherPageClient from "./TeacherPageClient";

export default async function TeacherPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/teacher");
  redirectTutorAwayFromAdminPages(viewer);
  const navViewer = await buildAppTopNavViewer(viewer);
  return <TeacherPageClient navViewer={navViewer} />;
}
