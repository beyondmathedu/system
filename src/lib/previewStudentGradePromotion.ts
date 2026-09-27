import { formatAcademicYearId } from "@/lib/academicYear";
import { formatGradeDisplay, normalizeGradeCode } from "@/lib/grade";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type PromotionPreviewAction =
  | "promote"
  | "repeat"
  | "sync_from_history"
  | "graduate_f6"
  | "unchanged";

export type PromotionPreviewRow = {
  studentId: string;
  nameZh: string;
  nicknameEn: string;
  fromGrade: string;
  toGrade: string;
  action: PromotionPreviewAction;
  reason: string;
};

export type PromotionPreviewResult = {
  targetYear: number;
  newAy: string;
  prevAy: string;
  alreadyRun: boolean;
  rows: PromotionPreviewRow[];
  counts: Record<PromotionPreviewAction, number>;
};

const PROMOTE_NEXT: Record<string, string> = {
  F1: "F2",
  F2: "F3",
  F3: "F4",
  F4: "F5",
  F5: "F6",
};

function emptyCounts(): Record<PromotionPreviewAction, number> {
  return {
    promote: 0,
    repeat: 0,
    sync_from_history: 0,
    graduate_f6: 0,
    unchanged: 0,
  };
}

/**
 * Read-only preview of what Sept grade promotion would do (aligned with
 * `run_student_grade_promotion` SQL). Does not write anything.
 */
export async function previewStudentGradePromotion(input?: {
  year?: number | null;
}): Promise<PromotionPreviewResult> {
  const admin = getSupabaseAdmin();
  const nowHk = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }),
  );
  const targetYear =
    typeof input?.year === "number" && Number.isFinite(input.year)
      ? Math.trunc(input.year)
      : nowHk.getFullYear();
  const newAy = formatAcademicYearId(targetYear);
  const prevAy = formatAcademicYearId(targetYear - 1);

  const { data: runRows } = await admin
    .from("student_grade_promotion_runs")
    .select("run_year")
    .eq("run_year", targetYear)
    .limit(1);
  const alreadyRun = Boolean(runRows?.length);

  const [{ data: students, error: stErr }, { data: history, error: histErr }, { data: held, error: heldErr }] =
    await Promise.all([
      admin.from("students").select("id, name_zh, nickname_en, grade").order("id"),
      admin
        .from("student_grade_history")
        .select("student_id, academic_year, grade, status")
        .eq("academic_year", newAy),
      admin
        .from("student_held_back_years")
        .select("student_id, promotion_year")
        .eq("promotion_year", targetYear),
    ]);

  if (stErr) throw new Error(stErr.message);
  if (histErr && !/does not exist|schema cache|not found/i.test(histErr.message)) {
    throw new Error(histErr.message);
  }
  if (heldErr && !/does not exist|schema cache|not found/i.test(heldErr.message)) {
    throw new Error(heldErr.message);
  }

  const historyByStudent = new Map<string, { grade: string; status: string }>();
  for (const row of history ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "").trim();
    if (!sid) continue;
    historyByStudent.set(sid, {
      grade: normalizeGradeCode(String((row as { grade?: string }).grade ?? "")),
      status: String((row as { status?: string }).status ?? ""),
    });
  }
  const heldSet = new Set(
    (held ?? [])
      .map((r) => String((r as { student_id?: string }).student_id ?? "").trim())
      .filter(Boolean),
  );

  const rows: PromotionPreviewRow[] = [];
  const counts = emptyCounts();

  for (const raw of students ?? []) {
    const studentId = String((raw as { id?: string }).id ?? "").trim();
    if (!studentId) continue;
    const nameZh = String((raw as { name_zh?: string | null }).name_zh ?? "");
    const nicknameEn = String((raw as { nickname_en?: string | null }).nickname_en ?? "");
    const fromGrade = normalizeGradeCode(String((raw as { grade?: string | null }).grade ?? ""));
    if (!fromGrade) continue;

    const existing = historyByStudent.get(studentId);
    let action: PromotionPreviewAction = "unchanged";
    let toGrade = fromGrade;
    let reason = "無變更";

    if (existing?.grade) {
      toGrade = existing.grade;
      if (existing.grade !== fromGrade) {
        action = "sync_from_history";
        reason = `已有 ${newAy} History ${formatGradeDisplay(existing.grade)}，會把 Student Info 改成 History`;
      } else if (existing.status === "repeating" || heldSet.has(studentId)) {
        action = "repeat";
        reason = `留班／Repeating：維持 ${formatGradeDisplay(fromGrade)}`;
      } else {
        action = "unchanged";
        reason = `已有 ${newAy} History，與 Info 相同`;
      }
    } else if (heldSet.has(studentId)) {
      action = "repeat";
      toGrade = fromGrade;
      reason = `held_back ${targetYear}：不升班，維持 ${formatGradeDisplay(fromGrade)}`;
    } else if (fromGrade === "F6") {
      action = "graduate_f6";
      toGrade = "F6";
      reason = "F.6：自動加入畢業／隱藏期（7/1 起）";
    } else if (PROMOTE_NEXT[fromGrade]) {
      action = "promote";
      toGrade = PROMOTE_NEXT[fromGrade];
      reason = `${formatGradeDisplay(fromGrade)} → ${formatGradeDisplay(toGrade)}`;
    }

    counts[action] += 1;
    if (action === "unchanged") continue;
    rows.push({
      studentId,
      nameZh,
      nicknameEn,
      fromGrade,
      toGrade,
      action,
      reason,
    });
  }

  rows.sort((a, b) => a.studentId.localeCompare(b.studentId));

  return {
    targetYear,
    newAy,
    prevAy,
    alreadyRun,
    rows,
    counts,
  };
}
