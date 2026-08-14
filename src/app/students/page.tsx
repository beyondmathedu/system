import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import { studentPortalHomePath } from "@/lib/studentPortalAccess";
import { getStudentPortalStatusBatch } from "@/lib/studentPortalProvision.server";
import { listStudentsForPage } from "@/lib/studentsListServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeStudentId } from "@/lib/studentId";
import StudentsPageEntry from "./StudentsPageEntry";

const STUDENTS_PAGE_SIZE = 80;

export default async function StudentsPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/students");
  redirectTutorAwayFromAdminPages(viewer);
  if (viewer.role === "student") {
    const sid = normalizeStudentId(viewer.studentId ?? "");
    if (sid) redirect(studentPortalHomePath(sid));
    redirect("/login");
  }
  const navViewer = await buildAppTopNavViewer(viewer);

  let initialList: {
    students: Awaited<ReturnType<typeof listStudentsForPage>>["rows"];
    total: number;
    portalStatusById: Awaited<ReturnType<typeof getStudentPortalStatusBatch>>;
  } | null = null;
  try {
    const result = await listStudentsForPage(getSupabaseAdmin(), {
      offset: 0,
      limit: STUDENTS_PAGE_SIZE,
      status: "active",
    });
    const portalStatusById = await getStudentPortalStatusBatch(result.rows.map((r) => r.id));
    initialList = {
      students: result.rows,
      total: result.total,
      portalStatusById,
    };
  } catch {
    initialList = null;
  }

  return <StudentsPageEntry navViewer={navViewer} initialList={initialList} />;
}
