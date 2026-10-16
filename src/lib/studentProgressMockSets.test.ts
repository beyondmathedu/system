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
  it("keeps the school-mock years in numeric order", () => {
    expect(normalizeMockYearLabels(["2526", "1213", "1617", "1213", " "])).toEqual([
      "1213",
      "1617",
      "2526",
    ]);
  });
});
