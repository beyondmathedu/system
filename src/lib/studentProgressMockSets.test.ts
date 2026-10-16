import { describe, expect, it } from "vitest";
import { normalizeMockSetLabels, normalizeMockYearLabels } from "@/lib/studentProgressMockSets";

describe("normalizeMockSetLabels", () => {
  it("sorts set codes A–Z and keeps Others last", () => {
    expect(
      normalizeMockSetLabels(["(Set B) Beta", "Others", "(Set A) Alpha", "(Set AA) Double"]),
    ).toEqual(["(Set A) Alpha", "(Set AA) Double", "(Set B) Beta", "Others"]);
  });

  it("drops blanks and duplicates", () => {
    expect(normalizeMockSetLabels(["  (Set A) Alpha  ", "", "(Set A) Alpha"])).toEqual([
      "(Set A) Alpha",
    ]);
  });
});

describe("normalizeMockYearLabels", () => {
  it("sorts school-mock years from largest to smallest", () => {
    expect(normalizeMockYearLabels(["1213", "2526", "1617", "2526", " "])).toEqual([
      "2526",
      "1617",
      "1213",
    ]);
  });
});
