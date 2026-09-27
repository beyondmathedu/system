import { describe, expect, it } from "vitest";
import {
  coerceProgressSelectionMap,
  progressSelectionsEqual,
} from "@/lib/studentProgressSelections";

describe("coerceProgressSelectionMap", () => {
  it("keeps non-empty string values", () => {
    expect(
      coerceProgressSelectionMap({
        "F1::0::3": "Good",
        "F1::1::3": " ",
        "F1::2::3": null,
        "": "x",
      }),
    ).toEqual({ "F1::0::3": "Good" });
  });
});

describe("progressSelectionsEqual", () => {
  it("compares maps by key/value", () => {
    expect(progressSelectionsEqual({ a: "1" }, { a: "1" })).toBe(true);
    expect(progressSelectionsEqual({ a: "1" }, { a: "2" })).toBe(false);
    expect(progressSelectionsEqual({ a: "1" }, { a: "1", b: "2" })).toBe(false);
  });
});
