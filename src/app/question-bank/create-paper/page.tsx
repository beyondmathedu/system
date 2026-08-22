import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import CreatePaperClient from "./CreatePaperClient";

export default async function CreatePaperPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/question-bank/create-paper");
  redirectTutorAwayFromAdminPages(viewer);
  if (viewer.role !== "admin") redirect("/login");

  const navViewer = await buildAppTopNavViewer(viewer);
  return <CreatePaperClient navViewer={navViewer} />;
}
