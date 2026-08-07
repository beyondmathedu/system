import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import StudentProgressByIdClient from "./StudentProgressByIdClient";

type PageProps = { params: Promise<{ id: string }> };

export default async function StudentProgressByIdPage({ params }: PageProps) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    const { id } = await params;
    redirect(`/login?next=${encodeURIComponent(`/student-progress/${id}`)}`);
  }
  redirectTutorAwayFromAdminPages(viewer);
  const navViewer = await buildAppTopNavViewer(viewer);
  return <StudentProgressByIdClient navViewer={navViewer} />;
}
