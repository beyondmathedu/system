import {
  formatVisibleExamDateSlashed,
  hkTodayIso,
  isUpcomingExamDate,
  visibleExamContent,
  visibleExamDateIso,
} from "@/lib/examDateVisibility";

export type StudentExamInfo = {
  examDate: string;
  examContent: string;
  m1ExamDate: string;
  m1ExamContent: string;
  m2ExamDate: string;
  m2ExamContent: string;
};

export const EMPTY_STUDENT_EXAM_INFO: StudentExamInfo = {
  examDate: "",
  examContent: "",
  m1ExamDate: "",
  m1ExamContent: "",
  m2ExamDate: "",
  m2ExamContent: "",
};

export type StudentExamDbRow = {
  exam_date?: string | null;
  exam_content?: string | null;
  m1_exam_date?: string | null;
  m1_exam_content?: string | null;
  m2_exam_date?: string | null;
  m2_exam_content?: string | null;
};

export type ExamPaperKey = "compulsory" | "m1" | "m2";

export type ExamPaperEntry = {
  key: ExamPaperKey;
  label: string;
  dateLabel: string;
  contentLabel: string;
  examDate: string;
  examContent: string;
};

const PAPER_META: Record<
  ExamPaperKey,
  { label: string; dateLabel: string; contentLabel: string }
> = {
  compulsory: {
    label: "Compulsory",
    dateLabel: "Latest Exam Date",
    contentLabel: "Exam Content",
  },
  m1: {
    label: "M1",
    dateLabel: "M1 Exam Date",
    contentLabel: "M1 Exam Content",
  },
  m2: {
    label: "M2",
    dateLabel: "M2 Exam Date",
    contentLabel: "M2 Exam Content",
  },
};

export function normalizeStudentExamInfo(
  value?: Partial<StudentExamInfo> | null,
): StudentExamInfo {
  return {
    examDate: String(value?.examDate ?? ""),
    examContent: String(value?.examContent ?? ""),
    m1ExamDate: String(value?.m1ExamDate ?? ""),
    m1ExamContent: String(value?.m1ExamContent ?? ""),
    m2ExamDate: String(value?.m2ExamDate ?? ""),
    m2ExamContent: String(value?.m2ExamContent ?? ""),
  };
}

export function studentExamInfoFromDbRow(
  row: StudentExamDbRow | null | undefined,
): StudentExamInfo {
  if (!row) return { ...EMPTY_STUDENT_EXAM_INFO };
  return {
    examDate: String(row.exam_date ?? ""),
    examContent: row.exam_content ? String(row.exam_content) : "",
    m1ExamDate: String(row.m1_exam_date ?? ""),
    m1ExamContent: row.m1_exam_content ? String(row.m1_exam_content) : "",
    m2ExamDate: String(row.m2_exam_date ?? ""),
    m2ExamContent: row.m2_exam_content ? String(row.m2_exam_content) : "",
  };
}

export function studentExamInfoToDbPayload(info: StudentExamInfo) {
  const normalized = normalizeStudentExamInfo(info);
  return {
    exam_date: normalized.examDate,
    exam_content: normalized.examContent,
    m1_exam_date: normalized.m1ExamDate,
    m1_exam_content: normalized.m1ExamContent,
    m2_exam_date: normalized.m2ExamDate,
    m2_exam_content: normalized.m2ExamContent,
  };
}

export const STUDENT_EXAM_SELECT =
  "exam_date, exam_content, m1_exam_date, m1_exam_content, m2_exam_date, m2_exam_content";

export const STUDENT_EXAM_SELECT_WITH_ID = `student_id, ${STUDENT_EXAM_SELECT}`;

export function listExamPapers(
  info: StudentExamInfo,
  options?: { takesM1?: boolean; takesM2?: boolean },
): ExamPaperEntry[] {
  const normalized = normalizeStudentExamInfo(info);
  const out: ExamPaperEntry[] = [
    {
      key: "compulsory",
      ...PAPER_META.compulsory,
      examDate: normalized.examDate,
      examContent: normalized.examContent,
    },
  ];
  if (options?.takesM1) {
    out.push({
      key: "m1",
      ...PAPER_META.m1,
      examDate: normalized.m1ExamDate,
      examContent: normalized.m1ExamContent,
    });
  }
  if (options?.takesM2) {
    out.push({
      key: "m2",
      ...PAPER_META.m2,
      examDate: normalized.m2ExamDate,
      examContent: normalized.m2ExamContent,
    });
  }
  return out;
}

export function listVisibleExamPapers(
  info: StudentExamInfo,
  options?: { takesM1?: boolean; takesM2?: boolean; todayIso?: string },
): ExamPaperEntry[] {
  const todayIso = options?.todayIso ?? hkTodayIso();
  return listExamPapers(info, options).filter((paper) =>
    isUpcomingExamDate(paper.examDate, todayIso),
  );
}

/** Earliest upcoming exam date among enabled papers (ISO). */
export function nearestUpcomingExamDate(
  info: StudentExamInfo,
  options?: { takesM1?: boolean; takesM2?: boolean; todayIso?: string },
): string {
  const todayIso = options?.todayIso ?? hkTodayIso();
  const takesM1 = options?.takesM1 ?? true;
  const takesM2 = options?.takesM2 ?? true;
  let nearest = "";
  for (const paper of listExamPapers(info, { takesM1, takesM2 })) {
    const visible = visibleExamDateIso(paper.examDate, todayIso);
    if (!visible) continue;
    if (!nearest || visible < nearest) nearest = visible;
  }
  return nearest;
}

/** Compact D/M for timetable cells; prefixes M1/M2 when that paper is the nearest. */
export function formatNearestExamDateSlashed(
  info: StudentExamInfo,
  options?: { takesM1?: boolean; takesM2?: boolean; todayIso?: string },
): string {
  const todayIso = options?.todayIso ?? hkTodayIso();
  const takesM1 = options?.takesM1 ?? true;
  const takesM2 = options?.takesM2 ?? true;
  const visible = listVisibleExamPapers(info, { takesM1, takesM2, todayIso });
  if (!visible.length) return "";
  let nearest = visible[0]!;
  for (const paper of visible.slice(1)) {
    if (paper.examDate < nearest.examDate) nearest = paper;
  }
  const slashed = formatVisibleExamDateSlashed(nearest.examDate, todayIso);
  if (!slashed) return "";
  if (nearest.key === "compulsory") return slashed;
  return `${nearest.label} ${slashed}`;
}

/** Room/content column: join upcoming papers with labels when more than one may apply. */
export function formatVisibleExamContentsSummary(
  info: StudentExamInfo,
  options?: { takesM1?: boolean; takesM2?: boolean; todayIso?: string },
): string {
  const todayIso = options?.todayIso ?? hkTodayIso();
  const takesM1 = options?.takesM1 ?? true;
  const takesM2 = options?.takesM2 ?? true;
  const parts: string[] = [];
  for (const paper of listVisibleExamPapers(info, { takesM1, takesM2, todayIso })) {
    const content = visibleExamContent(paper.examDate, paper.examContent, todayIso);
    if (!content) continue;
    const prefix = paper.key === "compulsory" ? "" : `${paper.label}: `;
    parts.push(`${prefix}${content}`);
  }
  return parts.join(" · ");
}

/** Date column summary: soonest upcoming; prefix M1/M2 when that paper wins. */
export function formatNearestExamDateIsoLabeled(
  info: StudentExamInfo,
  options?: { takesM1?: boolean; takesM2?: boolean; todayIso?: string },
): { iso: string; label: string } {
  const todayIso = options?.todayIso ?? hkTodayIso();
  const takesM1 = options?.takesM1 ?? true;
  const takesM2 = options?.takesM2 ?? true;
  const visible = listVisibleExamPapers(info, { takesM1, takesM2, todayIso });
  if (!visible.length) return { iso: "", label: "" };
  let nearest = visible[0]!;
  for (const paper of visible.slice(1)) {
    if (paper.examDate < nearest.examDate) nearest = paper;
  }
  return {
    iso: nearest.examDate,
    label: nearest.key === "compulsory" ? nearest.examDate : `${nearest.label} ${nearest.examDate}`,
  };
}
