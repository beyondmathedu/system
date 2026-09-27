import { describe, expect, it } from "vitest";
import { zohoSyncProgressPercent, ZOHO_DAILY_DETAIL_QUOTA } from "@/lib/zohoSyncCheckpoint";

describe("zohoSyncProgressPercent", () => {
  it("returns 0 for empty totals", () => {
    expect(zohoSyncProgressPercent(0, 0)).toBe(0);
    expect(zohoSyncProgressPercent(10, 0)).toBe(0);
  });

  it("clamps between 0 and 100", () => {
    expect(zohoSyncProgressPercent(0, 100)).toBe(0);
    expect(zohoSyncProgressPercent(50, 100)).toBe(50);
    expect(zohoSyncProgressPercent(100, 100)).toBe(100);
    expect(zohoSyncProgressPercent(120, 100)).toBe(100);
  });
});

describe("ZOHO_DAILY_DETAIL_QUOTA", () => {
  it("matches Zoho org daily detail budget used in UI", () => {
    expect(ZOHO_DAILY_DETAIL_QUOTA).toBe(1000);
  });
});
