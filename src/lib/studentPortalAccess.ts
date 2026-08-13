import { redirect } from "next/navigation";
import type { ViewerContext } from "@/lib/authz";
import { normalizeStudentId } from "@/lib/studentId";

/** Student portal home: lessons hub (not a specific year page). */
export function studentPortalHomePath(studentId: string): string {
  const sid = normalizeStudentId(studentId);
  return `/students/${encodeURIComponent(sid)}/lessons`;
}

/** Students only see their own lesson pages — not admin home / fee record. */
export function redirectStudentAwayFromAdminPages(viewer: ViewerContext): void {
  if (viewer.role !== "student") return;
  const sid = normalizeStudentId(viewer.studentId ?? "");
  if (!sid) redirect("/login");
  redirect(studentPortalHomePath(sid));
}

export function isStudentViewer(viewer: ViewerContext): boolean {
  return viewer.role === "student";
}
