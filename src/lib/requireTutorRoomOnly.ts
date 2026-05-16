import { redirect } from "next/navigation";
import type { ViewerContext } from "@/lib/authz";
import { getTutorLandingPath, isSharedIpadTutorViewer, isTutorViewer } from "@/lib/tutorRoomAccess";

/** 導師／共用 iPad 帳不可進後台；共用 iPad 用主頁選教室 */
export function redirectTutorAwayFromAdminPages(viewer: ViewerContext): void {
  if (isSharedIpadTutorViewer(viewer)) {
    redirect("/home");
    return;
  }
  if (!isTutorViewer(viewer)) return;
  const landing = getTutorLandingPath(viewer) ?? "/rooms";
  redirect(landing);
}
