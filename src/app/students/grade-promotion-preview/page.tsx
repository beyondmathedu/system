import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import GradePromotionPreviewClient from "./GradePromotionPreviewClient";

export default async function GradePromotionPreviewPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/students/grade-promotion-preview");
  if (viewer.role !== "admin") redirect("/students");
  const navViewer = await buildAppTopNavViewer(viewer);
  return <GradePromotionPreviewClient navViewer={navViewer} />;
}
