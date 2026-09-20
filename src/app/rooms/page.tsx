import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { fetchClassroomsAdminList } from "@/lib/classroomsRegistry";
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

  const [navViewer, initialRows] = await Promise.all([
    buildAppTopNavViewer(viewer),
    fetchClassroomsAdminList(),
  ]);
  return (
    <RoomsAdminClient
      navViewer={navViewer}
      initialRows={initialRows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        sort_order: r.sort_order,
        regular_period_max: r.regular_period_max ?? null,
      }))}
    />
  );
}
