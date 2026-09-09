import { describe, expect, it } from "vitest";
import {
  getStudentGradeForDate,
  getStudentGradeForMonth,
  historyEntry,
} from "@/lib/studentGradeHistory";
import { gradeForFeePricing } from "@/lib/studentFeePricingGrade";

describe("Case A: normal progression via Grade History", () => {
  const history = {
    ...historyEntry("2025-26", "F3", "normal"),
    ...historyEntry("2026-27", "F4", "promoted"),
    ...historyEntry("2027-28", "F5", "promoted"),
  };

  it("resolves months by academic year", () => {
    expect(
      getStudentGradeForMonth({
        currentGrade: "F5",
        sheetYear: 2026,
        sheetMonth: 8,
        historyByAcademicYear: history,
      }),
    ).toBe("F3");
    expect(
      getStudentGradeForMonth({
        currentGrade: "F5",
        sheetYear: 2026,
        sheetMonth: 9,
        historyByAcademicYear: history,
      }),
    ).toBe("F4");
    expect(
      getStudentGradeForMonth({
        currentGrade: "F5",
        sheetYear: 2027,
        sheetMonth: 8,
        historyByAcademicYear: history,
      }),
    ).toBe("F4");
    expect(
      getStudentGradeForMonth({
        currentGrade: "F5",
        sheetYear: 2027,
        sheetMonth: 9,
        historyByAcademicYear: history,
      }),
    ).toBe("F5");
  });
});

describe("Case B: repeating year via Grade History", () => {
  const history = {
    ...historyEntry("2025-26", "F3", "normal"),
    ...historyEntry("2026-27", "F3", "repeating"),
    ...historyEntry("2027-28", "F4", "promoted"),
  };

  it("keeps F3 across 2026-27 and promotes in 2027-28", () => {
    expect(
      getStudentGradeForMonth({
        currentGrade: "F4",
        sheetYear: 2026,
        sheetMonth: 8,
        historyByAcademicYear: history,
      }),
    ).toBe("F3");
    expect(
      getStudentGradeForMonth({
        currentGrade: "F4",
        sheetYear: 2026,
        sheetMonth: 9,
        historyByAcademicYear: history,
      }),
    ).toBe("F3");
    expect(
      getStudentGradeForMonth({
        currentGrade: "F4",
        sheetYear: 2027,
        sheetMonth: 8,
        historyByAcademicYear: history,
      }),
    ).toBe("F3");
    expect(
      getStudentGradeForMonth({
        currentGrade: "F4",
        sheetYear: 2027,
        sheetMonth: 9,
        historyByAcademicYear: history,
      }),
    ).toBe("F4");
  });

  it("does not let current grade rewrite past history months (Case C)", () => {
    expect(
      getStudentGradeForMonth({
        currentGrade: "F6",
        sheetYear: 2026,
        sheetMonth: 9,
        historyByAcademicYear: history,
      }),
    ).toBe("F3");
  });
});

describe("Case D: Fee Table pricing uses same history lookup", () => {
  const history = {
    ...historyEntry("2026-27", "F3", "repeating"),
  };

  it("gradeForFeePricing matches getStudentGradeForMonth", () => {
    const fromFee = gradeForFeePricing("F4", 2026, 9, "", null, history);
    const fromMonth = getStudentGradeForMonth({
      currentGrade: "F4",
      sheetYear: 2026,
      sheetMonth: 9,
      historyByAcademicYear: history,
    });
    expect(fromFee).toBe(fromMonth);
    expect(fromFee).toBe("F3");
  });

  it("getStudentGradeForDate matches month helper", () => {
    expect(
      getStudentGradeForDate({
        currentGrade: "F4",
        dateIso: "2026-09-15",
        historyByAcademicYear: history,
      }),
    ).toBe("F3");
    expect(
      getStudentGradeForDate({
        currentGrade: "F4",
        dateIso: "2026-08-15",
        historyByAcademicYear: {
          ...historyEntry("2025-26", "F3", "normal"),
          ...history,
        },
      }),
    ).toBe("F3");
  });
});

describe("fallback without history still uses held-back years", () => {
  it("falls back to inferGradeAtSheetEnd", () => {
    expect(
      getStudentGradeForMonth({
        currentGrade: "F4",
        sheetYear: 2026,
        sheetMonth: 8,
        heldBackYears: [2026],
      }),
    ).toBe("F4");
  });
});
