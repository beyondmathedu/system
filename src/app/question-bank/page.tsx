import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import QuestionBankClient from "./QuestionBankClient";

export default async function QuestionBankPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/question-bank");
  redirectTutorAwayFromAdminPages(viewer);
  if (viewer.role !== "admin") redirect("/login");

  const navViewer = await buildAppTopNavViewer(viewer);
  return <QuestionBankClient navViewer={navViewer} />;
}
