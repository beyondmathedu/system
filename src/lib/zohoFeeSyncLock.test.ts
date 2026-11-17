import { describe, expect, it } from "vitest";
import {
  isZohoFeeMonthLocked,
  normalizeZohoFeeSyncLockPeriod,
} from "@/lib/zohoFeeSyncLock";

describe("normalizeZohoFeeSyncLockPeriod", () => {
  it("clears when either side is unset", () => {
    expect(normalizeZohoFeeSyncLockPeriod(0, 5)).toEqual({ fromMonth: 0, toMonth: 0 });
    expect(normalizeZohoFeeSyncLockPeriod(5, 0)).toEqual({ fromMonth: 0, toMonth: 0 });
  });

  it("swaps when from > to", () => {
    expect(normalizeZohoFeeSyncLockPeriod(8, 5)).toEqual({ fromMonth: 5, toMonth: 8 });
  });
});

describe("isZohoFeeMonthLocked", () => {
  it("unlocks when period is empty", () => {
    expect(isZohoFeeMonthLocked(5, { fromMonth: 0, toMonth: 0 })).toBe(false);
    expect(isZohoFeeMonthLocked(5, null)).toBe(false);
  });

  it("locks only months inside the period", () => {
    const lock = { fromMonth: 5, toMonth: 5 };
    expect(isZohoFeeMonthLocked(4, lock)).toBe(false);
    expect(isZohoFeeMonthLocked(5, lock)).toBe(true);
    expect(isZohoFeeMonthLocked(6, lock)).toBe(false);
  });

  it("locks inclusive ranges", () => {
    const lock = { fromMonth: 5, toMonth: 7 };
    expect(isZohoFeeMonthLocked(5, lock)).toBe(true);
    expect(isZohoFeeMonthLocked(6, lock)).toBe(true);
    expect(isZohoFeeMonthLocked(7, lock)).toBe(true);
    expect(isZohoFeeMonthLocked(8, lock)).toBe(false);
  });
});
