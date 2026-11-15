import { describe, expect, it } from "vitest";
import {
  buildStudentInactivePeriodsById,
  isStudentHiddenForFeeSheetMonthFromPeriods,
  makeStudentInactiveDateCheckerFromPeriods,
} from "@/lib/studentVisibility";
import { getStudentGradeForMonth } from "@/lib/studentGradeHistory";

describe("graduated F6 May inactive on fee sheet", () => {
  const periods = buildStudentInactivePeriodsById([
    {
      student_id: "00100",
      start_date: "2026-05-01",
      end_date: null,
      note: "auto: F6 graduated 2026 (pre-Sept cohort)",
    },
  ])["00100"]!;

  it("hides May fee month even when grade-on-month rolls back to F5", () => {
    const gradeMay = getStudentGradeForMonth({
      currentGrade: "F6",
      sheetYear: 2026,
      sheetMonth: 5,
    });
    expect(gradeMay).toBe("F5");
    expect(
      isStudentHiddenForFeeSheetMonthFromPeriods({
        periods,
        studentId: "00100",
        grade: gradeMay,
        sheetYear: 2026,
        sheetMonth: 5,
      }),
    ).toBe(true);
  });

  it("marks May lesson dates inactive via graduated period", () => {
    const checker = makeStudentInactiveDateCheckerFromPeriods({
      periods,
      studentId: "00100",
      grade: "F6",
      year: 2026,
    });
    expect(checker("2026-04-30")).toBe(false);
    expect(checker("2026-05-01")).toBe(true);
    expect(checker("2026-05-15")).toBe(true);
    expect(checker("2026-06-15")).toBe(true);
  });
});
