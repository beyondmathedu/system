import { describe, expect, it } from "vitest";
import {
  clampPercent,
  normalizeBBox,
  parseConfidence,
  parseDifficulty,
  TEST_MODE_MAX_PAGES,
} from "@/lib/questionBankTypes";

describe("questionBankTypes", () => {
  it("clamps percent values", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(120)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it("normalizes bbox within page bounds", () => {
    expect(normalizeBBox({ top: 10, left: 5, width: 90, height: 30 })).toEqual({
      top: 10,
      left: 5,
      width: 90,
      height: 30,
    });
    expect(normalizeBBox({ top: 80, left: 70, width: 50, height: 50 })).toEqual({
      top: 80,
      left: 70,
      width: 30,
      height: 20,
    });
  });

  it("parses difficulty levels", () => {
    expect(parseDifficulty("L1")).toBe("L1");
    expect(parseDifficulty("l2")).toBe("L2");
    expect(parseDifficulty("needs_review")).toBe("needs_review");
    expect(parseDifficulty("unknown")).toBe("needs_review");
  });

  it("parses confidence", () => {
    expect(parseConfidence(0.87)).toBe(0.87);
    expect(parseConfidence(1.5)).toBe(1);
    expect(parseConfidence(-0.1)).toBe(0);
    expect(parseConfidence("bad")).toBeNull();
  });

  it("limits test mode pages", () => {
    expect(TEST_MODE_MAX_PAGES).toBe(3);
  });
});
