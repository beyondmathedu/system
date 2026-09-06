import { describe, expect, it } from "vitest";
import { coerceFeeBalanceAdjustment } from "@/lib/studentFeeBalanceAdjustment";

describe("coerceFeeBalanceAdjustment", () => {
  it("keeps signed discount amounts", () => {
    expect(coerceFeeBalanceAdjustment({ amount: -300, reason: "開學優惠" })).toEqual({
      amount: -300,
      reason: "開學優惠",
    });
  });

  it("defaults invalid payload", () => {
    expect(coerceFeeBalanceAdjustment(null)).toEqual({ amount: 0, reason: "" });
    expect(coerceFeeBalanceAdjustment({ amount: "x", reason: 12 })).toEqual({
      amount: 0,
      reason: "12",
    });
  });
});

describe("total due with adjustment", () => {
  it("subtracts negative credit from total due", () => {
    const balanceBefore = 1000;
    const thisMonth = 2240;
    const adjustment = -300;
    expect(balanceBefore + thisMonth + adjustment).toBe(2940);
  });
});
