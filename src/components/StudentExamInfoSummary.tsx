import {
  listVisibleExamPapers,
  type StudentExamInfo,
} from "@/lib/studentExamInfo";

export default function StudentExamInfoSummary({
  examInfo,
  takesM1 = false,
  takesM2 = false,
  todayIso,
}: {
  examInfo: StudentExamInfo;
  takesM1?: boolean;
  takesM2?: boolean;
  todayIso?: string;
}) {
  const papers = listVisibleExamPapers(examInfo, { takesM1, takesM2, todayIso });
  if (!papers.length) return null;

  return (
    <>
      {papers.map((paper) => (
        <div key={paper.key} className="space-y-3">
          <div>
            <p className="text-xs font-semibold tracking-wider text-slate-500">{paper.dateLabel}</p>
            <p className="mt-1 text-sm font-bold text-slate-900">{paper.examDate || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wider text-slate-500">{paper.contentLabel}</p>
            <p className="mt-1 break-words text-sm font-bold text-slate-900">
              {paper.examContent || "—"}
            </p>
          </div>
        </div>
      ))}
    </>
  );
}
