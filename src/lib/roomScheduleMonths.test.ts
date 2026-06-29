import { describe, expect, it } from "vitest";
import { monthsToLoadForScheduleRange } from "@/lib/roomScheduleMonths";

describe("roomScheduleMonths", () => {
  it("returns fallback month when range is empty", () => {
    expect(monthsToLoadForScheduleRange("", "", 6)).toEqual([6]);
    expect(monthsToLoadForScheduleRange("2026-05-10", "", 3)).toEqual([3]);
  });

  it("expands contiguous months within the same year", () => {
    expect(monthsToLoadForScheduleRange("2026-05-10", "2026-07-20", 1)).toEqual([5, 6, 7]);
    expect(monthsToLoadForScheduleRange("2026-07-01", "2026-05-31", 1)).toEqual([5, 6, 7]);
  });

  it("expands a single month when range stays in one month", () => {
    expect(monthsToLoadForScheduleRange("2026-06-01", "2026-06-30", 5)).toEqual([6]);
  });

  it("spans year boundary when range crosses December to January", () => {
    expect(monthsToLoadForScheduleRange("2026-11-15", "2027-02-10", 6)).toEqual([
      1, 2, 11, 12,
    ]);
  });

  it("returns fallback for invalid iso fragments", () => {
    expect(monthsToLoadForScheduleRange("bad", "2026-06-01", 4)).toEqual([4]);
  });
});
