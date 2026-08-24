import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { getStudentPortalAccessState } from "@/lib/studentPortalAccess.server";
import { normalizeStudentId } from "@/lib/studentId";
import { loadTutorRoomNavLinks, defaultRoomScheduleSearch } from "@/lib/tutorRoomAccess";

/** 供導航列判斷 admin / tutor 與可見房間 */
export async function GET() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const isTutor = viewer.role === "tutor";
  const roomNavLinks = isTutor ? await loadTutorRoomNavLinks(viewer) : null;

  let studentPortalAllowed: boolean | undefined;
  let studentPortalReactivateDate: string | null | undefined;
  if (viewer.role === "student") {
    const sid = normalizeStudentId(viewer.studentId ?? "");
    if (sid) {
      const access = await getStudentPortalAccessState(sid);
      studentPortalAllowed = access.allowed;
      studentPortalReactivateDate = access.reactivateDate;
    } else {
      studentPortalAllowed = false;
      studentPortalReactivateDate = null;
    }
  }

  return NextResponse.json({
    ok: true,
    role: viewer.role,
    studentId: viewer.studentId,
    isSharedIpadTutor: viewer.isSharedIpadTutor,
    allowedRoomSlugs: viewer.allowedRoomSlugs,
    roomNavLinks,
    roomScheduleQuery: isTutor ? defaultRoomScheduleSearch(viewer) : null,
    studentPortalAllowed,
    studentPortalReactivateDate,
  });
}
