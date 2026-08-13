import { redirect } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import { studentPortalHomePath } from "@/lib/studentPortalAccess";
import { redirectIfInactiveStudentPortalBlocked } from "@/lib/studentPortalAccess.server";
import { normalizeStudentId } from "@/lib/studentId";

export default async function StudentProgressPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/student-progress");
  redirectTutorAwayFromAdminPages(viewer);
  if (viewer.role === "student") {
    await redirectIfInactiveStudentPortalBlocked(viewer);
    const sid = normalizeStudentId(viewer.studentId ?? "");
    if (sid) redirect(`/student-progress/${encodeURIComponent(sid)}`);
    redirect(studentPortalHomePath(sid || "00000"));
  }
  const navViewer = await buildAppTopNavViewer(viewer);

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="students" viewer={navViewer} />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">Student Progress</h1>
          </div>

          <div className="p-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
              <p className="text-sm text-slate-700">This is a new standalone Student Progress page.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
