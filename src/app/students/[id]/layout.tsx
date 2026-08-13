import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { studentPortalHomePath } from "@/lib/studentPortalAccess";
import { normalizeStudentId } from "@/lib/studentId";

/** Ensure students only open their own student id routes. */
export default async function StudentIdScopedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const viewer = await getViewerContext();
  if (viewer.role !== "student") return children;

  const { id } = await params;
  const pathStudentId = normalizeStudentId(id);
  const ownStudentId = normalizeStudentId(viewer.studentId ?? "");
  if (!ownStudentId) redirect("/login");
  if (pathStudentId !== ownStudentId) {
    redirect(studentPortalHomePath(ownStudentId));
  }
  return children;
}
