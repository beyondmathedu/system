import { redirect } from "next/navigation";
import type { ViewerContext } from "@/lib/authz";
import { studentLessonsYearPath } from "@/lib/lessonCalendar";
import { normalizeStudentId } from "@/lib/studentId";

export function studentPortalHomePath(studentId: string, year?: number): string {
  return studentLessonsYearPath(normalizeStudentId(studentId), year);
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
