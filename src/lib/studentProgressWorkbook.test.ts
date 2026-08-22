import { describe, expect, it } from "vitest";
import {
  F6_PRIMARY_SHEET_NAMES,
  F6_PROGRESS_SHEET_NAMES,
  getCumulativeSheetNames,
  getCurrentGradeSheetNames,
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
