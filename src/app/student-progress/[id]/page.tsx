import { redirect } from "next/navigation";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { loadExamInfoServer } from "@/lib/lessonDataServer";
import { redirectIfInactiveStudentPortalBlocked } from "@/lib/studentPortalAccess.server";
import { normalizeStudentId } from "@/lib/studentId";
import {
  parseGradeLevel,
  type ProgressSheet,
} from "@/lib/studentProgressWorkbook";
import { fetchStudentProgressForLevel } from "@/lib/studentProgressWorkbook.server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { isTutorViewer } from "@/lib/tutorRoomAccess";
import StudentProgressByIdClient, {
  type StudentProgressInitialPayload,
} from "./StudentProgressByIdClient";

type PageProps = { params: Promise<{ id: string }> };

export default async function StudentProgressByIdPage({ params }: PageProps) {
  const viewer = await getViewerContext();
  const { id } = await params;
  const studentId = normalizeStudentId(id);
  if (!viewer.userId) {
    redirect(`/login?next=${encodeURIComponent(`/student-progress/${id}`)}`);
  }
  // Tutors / shared iPad may open a single student's progress (read-only) from Lesson Record.
  // The list page `/student-progress` remains admin-only.
  if (viewer.role === "student") {
    await redirectIfInactiveStudentPortalBlocked(viewer);
    const ownId = normalizeStudentId(viewer.studentId ?? "");
    if (!ownId) redirect("/login");
    if (studentId !== ownId) redirect(`/student-progress/${encodeURIComponent(ownId)}`);
  }
  const navViewer = await buildAppTopNavViewer(viewer);
  const readOnly = viewer.role === "student" || isTutorViewer(viewer);

  let initial: StudentProgressInitialPayload | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const [studentRes, examInfo] = await Promise.all([
      supabase
        .from("students")
        .select("id, name_zh, name_en, nickname_en, grade, school, textbook_publisher, math_language")
        .eq("id", studentId)
        .maybeSingle(),
      loadExamInfoServer(supabase, studentId),
    ]);

    const data = studentRes.data;
    if (data) {
      const summary = {
        id: String(data.id),
        nameZh: String(data.name_zh ?? ""),
        nameEn: String(data.name_en ?? ""),
        nicknameEn: String(data.nickname_en ?? ""),
        grade: String(data.grade ?? ""),
        school: String(data.school ?? ""),
        textbookPublisher: String(data.textbook_publisher ?? ""),
        mathLanguage: String(data.math_language ?? "English"),
      };
      const level = parseGradeLevel(summary.grade);
      let sheets: ProgressSheet[] = [];
      let cutOffSheet: ProgressSheet | null = null;
      let yearGradeThresholds: Record<number, number[]> | undefined;
      if (level) {
        const payload = await fetchStudentProgressForLevel(level);
        sheets = payload.sheets;
        cutOffSheet = payload.cutOffSheet;
        yearGradeThresholds = payload.yearGradeThresholds;
      }
      initial = {
        studentSummary: summary,
        studentNotFound: false,
        examInfo,
        sheets,
        cutOffSheet,
        yearGradeThresholds,
      };
    } else {
      initial = {
        studentSummary: {
          id: studentId,
          nameZh: "",
          nameEn: "",
          nicknameEn: "",
          grade: "",
          school: "",
          textbookPublisher: "",
          mathLanguage: "English",
        },
        studentNotFound: true,
        examInfo,
        sheets: [],
        cutOffSheet: null,
        yearGradeThresholds: undefined,
      };
    }
  } catch {
    initial = null;
  }

  return (
    <StudentProgressByIdClient navViewer={navViewer} readOnly={readOnly} initial={initial} />
  );
}
