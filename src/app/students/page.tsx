import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import StudentsPageClient from "./StudentsPageClient";

export default async function StudentsPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/students");
  redirectTutorAwayFromAdminPages(viewer);
  const navViewer = await buildAppTopNavViewer(viewer);
  return <StudentsPageClient navViewer={navViewer} />;
}
