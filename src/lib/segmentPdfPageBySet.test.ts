import { describe, expect, it } from "vitest";
import {
  detectSetRegionsFromLines,
  extractSetHeaderLabel,
  groupTextItemsIntoLines,
  parseSetSourceLabel,
} from "@/lib/segmentPdfPageBySet";

describe("segmentPdfPageBySet", () => {
  it("groups pdf text items into lines", () => {
    const lines = groupTextItemsIntoLines([
      { str: "Set Z/", x: 40, y: 120, width: 30 },
      { str: "23-24/S6 Mock/I/Q7", x: 70, y: 120, width: 120 },
      { str: "Set X/", x: 40, y: 280, width: 30 },
      { str: "21-22/S6 Mock/I/Q6", x: 70, y: 280, width: 120 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.text).toContain("Set Z/");
    expect(lines[1]!.text).toContain("Set X/");
  });

  it("extracts Set header label from a line", () => {
    expect(extractSetHeaderLabel("Set Z/23-24/S6 Mock/I/Q7")).toBe("Set Z/23-24/S6 Mock/I/Q7");
  });

  it("parses source metadata from Set label", () => {
    expect(parseSetSourceLabel("Set Z/23-24/S6 Mock/I/Q7")).toEqual({
      sourceLabel: "Set Z/23-24/S6 Mock/I/Q7",
      sourceYear: "2023-24",
      examType: "S6 Mock / I",
      questionLabel: "7",
    });
  });

  it("splits page into one region per Set header", () => {
    const lines = [
      { y: 100, text: "Exam-type Questions", xMin: 40, xMax: 200 },
      { y: 140, text: "Set Z/23-24/S6 Mock/I/Q7", xMin: 40, xMax: 220 },
      { y: 160, text: "Question body (5 marks)", xMin: 40, xMax: 400 },
      { y: 300, text: "Set X/21-22/S6 Mock/I/Q6", xMin: 40, xMax: 220 },
      { y: 320, text: "Another question (4 marks)", xMin: 40, xMax: 400 },
    ];
    const regions = detectSetRegionsFromLines(lines, 800, 600, 2, "Coordinate Geometry");
    expect(regions).toHaveLength(2);
    expect(regions[0]!.sourceLabel).toBe("Set Z/23-24/S6 Mock/I/Q7");
    expect(regions[0]!.questionLabel).toBe("7");
    expect(regions[0]!.suggestedMarks).toBe(5);
    expect(regions[1]!.sourceLabel).toBe("Set X/21-22/S6 Mock/I/Q6");
    expect(regions[1]!.suggestedMarks).toBe(4);
    expect(regions[0]!.top).toBeLessThan(regions[1]!.top);
  });
});
