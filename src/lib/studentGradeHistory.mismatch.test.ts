import { describe, expect, it } from "vitest";
import { getCurrentAyGradeMismatch, historyEntry } from "@/lib/studentGradeHistory";

describe("getCurrentAyGradeMismatch", () => {
  it("returns null when grades match", () => {
    expect(
      getCurrentAyGradeMismatch({
        studentGrade: "F1",
        historyByAcademicYear: historyEntry("2026-27", "F1", "normal"),
        academicYear: "2026-27",
      }),
    ).toBeNull();
  });

  it("detects History ≠ Info", () => {
    expect(
      getCurrentAyGradeMismatch({
        studentGrade: "F1",
        historyByAcademicYear: historyEntry("2026-27", "F2", "promoted"),
        academicYear: "2026-27",
      }),
    ).toEqual({
      academicYear: "2026-27",
      infoGrade: "F1",
      historyGrade: "F2",
    });
  });

  it("ignores synthetic fallback notes", () => {
    expect(
      getCurrentAyGradeMismatch({
        studentGrade: "F1",
        historyByAcademicYear: {
          "2026-27": {
            academicYear: "2026-27",
            grade: "F2",
            status: "normal",
            note: "from students.grade",
          },
        },
        academicYear: "2026-27",
      }),
    ).toBeNull();
  });
});
