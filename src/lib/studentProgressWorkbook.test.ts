import { describe, expect, it } from "vitest";
import {
  F6_PRIMARY_SHEET_NAMES,
  F6_PROGRESS_SHEET_NAMES,
  getCumulativeSheetNames,
  getCurrentGradeSheetNames,
  getExtendedMathsSheetNames,
  getHighlightedProgressSheetNames,
  appendNextCutOffYear,
  M1_SHEET,
  M2_SHEET,
  stripF6LqLabelRows,
  syncF6ByYearsWithCutOff,
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

describe("appendNextCutOffYear", () => {
  it("appends the next year after the highest Cut Off year", () => {
    const sheet = appendNextCutOffYear({
      name: "Cut Off",
      headers: ["Level 等級", "2026/176(%)", "2025/191(%)"],
      rows: [
        ["5**", "167(95)", "172(90)"],
        ["2", "64(33)", "64(33)"],
      ],
    });
    expect(sheet.headers.at(-1)).toBe("2027/0(%)");
    expect(sheet.rows[0]).toEqual(["5**", "167(95)", "172(90)", ""]);
    expect(appendNextCutOffYear(sheet).headers.at(-1)).toBe("2028/0(%)");
  });
});

describe("syncF6ByYearsWithCutOff", () => {
  it("lists DSE years from largest to smallest", () => {
    const sheet = syncF6ByYearsWithCutOff(
      {
        name: "F6 By Years",
        headers: ["", "DSE", "Paper 1", "%", "Grade"],
        rows: [["F.6", "2024", "10", "0", "-"]],
      },
      {
        name: "Cut Off",
        headers: ["Level 等級", "2026/176(%)", "2012/198(%)", "2027/0(%)"],
        rows: [["2", "64(33)", "64(33)", ""]],
      },
    );
    expect(sheet.rows.map((row) => row[1])).toEqual(["2027", "2026", "2012"]);
    expect(sheet.rows[0]?.[0]).toBe("F.6");
  });
});

describe("stripF6LqLabelRows", () => {
  it("drops LQ group rows from the publisher F6 sheet", () => {
    const sheet = stripF6LqLabelRows({
      name: "F6",
      headers: ["", "Textbook: New Century"],
      rows: [
        ["F.6", "Arithmetic Sequences"],
        ["LQ A1"],
        ["LQ A2"],
        ["LQ B"],
        ["LQ A2 B"],
        ["Remedial"],
      ],
    });
    expect(sheet.rows.map((row) => row[0])).toEqual(["F.6", "Remedial"]);
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
