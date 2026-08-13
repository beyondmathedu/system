import "server-only";

import { redirect } from "next/navigation";
import type { ViewerContext } from "@/lib/authz";
import { defaultLessonYear } from "@/lib/lessonCalendar";
import { hkTodayIso } from "@/lib/examDateVisibility";
import { loadStudentInactivePeriodsBatchServer } from "@/lib/lessonDataServer";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { normalizeStudentId } from "@/lib/studentId";
import {
  buildStudentInactivePeriodsById,
  getStudentInactivePeriodOnDate,
  isStudentInactiveOnDateFromPeriods,
  withAutoF6InactivePeriod,
} from "@/lib/studentVisibility";

export type StudentPortalAccessState = {
  allowed: boolean;
  reactivateDate: string | null;
};

export async function getStudentPortalAccessState(
  studentId: string,
): Promise<StudentPortalAccessState> {
  const sid = normalizeStudentId(studentId);
  if (!sid) return { allowed: false, reactivateDate: null };

  const supabase = await createSupabaseServerClient();
  const [{ data: studentRow }, periodRows] = await Promise.all([
    supabase.from("students").select("grade").eq("id", sid).maybeSingle(),
    loadStudentInactivePeriodsBatchServer(supabase, [sid]),
  ]);

  const grade = String((studentRow as { grade?: string | null } | null)?.grade ?? "");
  const byId = buildStudentInactivePeriodsById(periodRows);
  const todayIso = hkTodayIso();
  const year = defaultLessonYear();
  const periods = withAutoF6InactivePeriod({
    periods: byId[sid] ?? [],
    studentId: sid,
    grade,
    year,
  });

  if (!isStudentInactiveOnDateFromPeriods({ periods, dateIso: todayIso })) {
    return { allowed: true, reactivateDate: null };
  }

  const covering = getStudentInactivePeriodOnDate(periods, todayIso);
  return { allowed: false, reactivateDate: covering?.endDate ?? null };
}

export function inactiveStudentPortalSignOutPath(reactivateDate?: string | null): string {
  const params = new URLSearchParams({ error: "student_inactive" });
  if (reactivateDate) params.set("reactivate", reactivateDate);
  return `/api/student-portal/sign-out?${params.toString()}`;
}

/** Block student portal when the student is inactive today (manual pause, graduated, F.6, etc.). */
export async function redirectIfInactiveStudentPortalBlocked(viewer: ViewerContext): Promise<void> {
  if (viewer.role !== "student") return;
  const sid = normalizeStudentId(viewer.studentId ?? "");
  if (!sid) return;
  const access = await getStudentPortalAccessState(sid);
  if (!access.allowed) {
    redirect(inactiveStudentPortalSignOutPath(access.reactivateDate));
  }
}
