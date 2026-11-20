import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { loadMobileAttendanceToday } from "@/lib/mobileAttendanceData.server";
import { studentPortalHomePath } from "@/lib/studentPortalAccess";
import { normalizeStudentId } from "@/lib/studentId";
import {
  ALL_CLASSROOM_SLUGS,
  isSharedIpadTutorViewer,
  isTutorViewer,
} from "@/lib/tutorRoomAccess";
import MobileAttendanceClient from "./MobileAttendanceClient";

export const dynamic = "force-dynamic";

export default async function MobileAttendancePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/m/attendance");
  if (viewer.role === "student" && viewer.studentId) {
    redirect(studentPortalHomePath(normalizeStudentId(viewer.studentId)));
  }
  if (viewer.role !== "admin" && viewer.role !== "tutor") {
    redirect("/login");
  }

  const slugs =
    viewer.role === "admin" || isSharedIpadTutorViewer(viewer)
      ? [...ALL_CLASSROOM_SLUGS]
      : isTutorViewer(viewer)
        ? viewer.allowedRoomSlugs
        : [];

  const payload = await loadMobileAttendanceToday(slugs);

  return (
    <div className="min-h-screen bg-slate-100">
      <MobileAttendanceClient
        dateIso={payload.dateIso}
        year={payload.year}
        initialRows={payload.rows}
        initialYearStates={payload.yearStatesByStudentId}
        loadError={payload.loadError}
      />
    </div>
  );
}
