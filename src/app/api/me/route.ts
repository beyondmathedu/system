import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { buildTutorRoomNavLinks, defaultRoomScheduleSearch } from "@/lib/tutorRoomAccess";

/** 供導航列判斷 admin / tutor 與可見房間 */
export async function GET() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const isTutor = viewer.role === "tutor";
  const roomNavLinks = isTutor ? buildTutorRoomNavLinks(viewer.allowedRoomSlugs) : null;
  return NextResponse.json({
    ok: true,
    role: viewer.role,
    isSharedIpadTutor: viewer.isSharedIpadTutor,
    allowedRoomSlugs: viewer.allowedRoomSlugs,
    roomNavLinks,
    roomScheduleQuery: isTutor ? defaultRoomScheduleSearch(viewer) : null,
  });
}
