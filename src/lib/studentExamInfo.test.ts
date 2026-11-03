import { describe, expect, it } from "vitest";
import {
  formatNearestExamDateSlashed,
  formatVisibleExamContentsSummary,
  listVisibleExamPapers,
  nearestUpcomingExamDate,
  normalizeStudentExamInfo,
} from "./studentExamInfo";

const today = "2026-11-03";

describe("studentExamInfo M1/M2", () => {
  it("lists only enabled upcoming papers", () => {
    const info = normalizeStudentExamInfo({
      examDate: "2026-11-10",
      examContent: "Ch1",
      m1ExamDate: "2026-11-05",
      m1ExamContent: "M1 quiz",
      m2ExamDate: "2026-10-01",
      m2ExamContent: "old",
    });
    const papers = listVisibleExamPapers(info, { takesM1: true, takesM2: true, todayIso: today });
    expect(papers.map((p) => p.key)).toEqual(["compulsory", "m1"]);
  });

  it("picks nearest upcoming date across papers", () => {
    const info = normalizeStudentExamInfo({
      examDate: "2026-11-20",
      m1ExamDate: "2026-11-08",
      m2ExamDate: "2026-11-15",
    });
    expect(nearestUpcomingExamDate(info, { takesM1: true, takesM2: true, todayIso: today })).toBe(
      "2026-11-08",
    );
    expect(formatNearestExamDateSlashed(info, { takesM1: true, takesM2: true, todayIso: today })).toBe(
      "M1 8/11",
    );
  });

  it("formats content summary with M1/M2 labels", () => {
    const info = normalizeStudentExamInfo({
      examDate: "2026-11-20",
      examContent: "Core",
      m1ExamDate: "2026-11-08",
      m1ExamContent: "Calc",
      m2ExamDate: "2026-11-15",
      m2ExamContent: "Alg",
    });
    expect(
      formatVisibleExamContentsSummary(info, { takesM1: true, takesM2: true, todayIso: today }),
    ).toBe("Core · M1: Calc · M2: Alg");
  });
});
