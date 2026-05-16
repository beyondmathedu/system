import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";

export default async function StudentsSectionLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/students");
  redirectTutorAwayFromAdminPages(viewer);
  if (viewer.role !== "admin") redirect("/login");
  return children;
}
