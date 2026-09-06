import { describe, expect, it } from "vitest";
import {
  currentHeldBackPromotionYear,
  heldBackYearLabel,
  normalizeHeldBackYears,
} from "@/lib/studentHeldBackYears";

describe("normalizeHeldBackYears", () => {
  it("dedupes and sorts valid years", () => {
    expect(normalizeHeldBackYears([2026, 2025, 2026, "2027"])).toEqual([2025, 2026, 2027]);
  });

  it("drops invalid values", () => {
    expect(normalizeHeldBackYears([null, "x", 1999, 2101, 2026])).toEqual([2026]);
  });
});

describe("currentHeldBackPromotionYear", () => {
  it("uses HK calendar year for this Sept decision", () => {
    expect(currentHeldBackPromotionYear(new Date("2026-05-01T04:00:00Z"))).toBe(2026);
    expect(currentHeldBackPromotionYear(new Date("2026-10-01T04:00:00Z"))).toBe(2026);
  });
});

describe("heldBackYearLabel", () => {
  it("shows compact academic-year wording", () => {
    expect(heldBackYearLabel(2026)).toBe("2026/27学年（2026/9–2027/8）");
  });
});
