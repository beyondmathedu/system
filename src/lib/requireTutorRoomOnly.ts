import { redirect } from "next/navigation";
import type { ViewerContext } from "@/lib/authz";
import { defaultDailyTimetablePath, isTutorViewer } from "@/lib/tutorRoomAccess";

/** 導師／共用 iPad 帳不可進後台；預設回到 Daily Timetable */
export function redirectTutorAwayFromAdminPages(viewer: ViewerContext): void {
  if (!isTutorViewer(viewer)) return;
  redirect(defaultDailyTimetablePath());
}
