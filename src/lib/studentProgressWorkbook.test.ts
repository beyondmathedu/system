import { describe, expect, it } from "vitest";
import {
  F6_PRIMARY_SHEET_NAMES,
  F6_PROGRESS_SHEET_NAMES,
  getCumulativeSheetNames,
  getCurrentGradeSheetNames,
  getExtendedMathsSheetNames,
  getHighlightedProgressSheetNames,
  M1_SHEET,
  M2_SHEET,
} from "@/lib/studentProgressWorkbook";

describe("getCumulativeSheetNames", () => {
  it("includes F5 and F6 sheets for level 5", () => {
    expect(getCumulativeSheetNames(5)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      ...F6_PROGRESS_SHEET_NAMES,
    ]);
  });

  it("keeps F5 when level is 6", () => {
    expect(getCumulativeSheetNames(6)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      ...F6_PROGRESS_SHEET_NAMES,
    ]);
  });

  it("stops before F5 for level 4", () => {
    expect(getCumulativeSheetNames(4)).toEqual(["F1", "F2", "F3", "F4"]);
  });
});

describe("getCurrentGradeSheetNames", () => {
  it("highlights F5 and F6 primary sheets for level 5", () => {
    expect(getCurrentGradeSheetNames(5)).toEqual(["F5", ...F6_PRIMARY_SHEET_NAMES]);
  });

  it("highlights F6 primary sheets for level 6", () => {
    expect(getCurrentGradeSheetNames(6)).toEqual([...F6_PRIMARY_SHEET_NAMES]);
  });
});

describe("Maths Extended M1/M2 sheets", () => {
  it("returns only the modules the student takes", () => {
    expect(getExtendedMathsSheetNames()).toEqual([]);
    expect(getExtendedMathsSheetNames({ takesM1: true })).toEqual([M1_SHEET]);
    expect(getExtendedMathsSheetNames({ takesM2: true })).toEqual([M2_SHEET]);
    expect(getExtendedMathsSheetNames({ takesM1: true, takesM2: true })).toEqual([
      M1_SHEET,
      M2_SHEET,
    ]);
  });

  it("highlights grade sheets plus M1/M2 when taken", () => {
    expect(getHighlightedProgressSheetNames(4, { takesM1: true })).toEqual(["F4", M1_SHEET]);
    expect(getHighlightedProgressSheetNames(6, { takesM1: true, takesM2: true })).toEqual([
      ...F6_PRIMARY_SHEET_NAMES,
      M1_SHEET,
      M2_SHEET,
    ]);
  });
});
