import { describe, expect, it } from "vitest";
import {
  mergeZohoBatchTotals,
  monthAmountMapFromKeyMap,
} from "@/lib/zohoSyncAccumulate";

describe("mergeZohoBatchTotals", () => {
  it("keeps earlier months when later batches only bring newer months", () => {
    const prior = {
      "00237": { 5: 1400, 6: 1120 },
    };
    const batch = new Map<string, number>([
      ["00237:7", 1400],
      ["00237:8", 1120],
    ]);
    const merged = mergeZohoBatchTotals(prior, batch);
    expect(merged.get("00237:5")).toBe(1400);
    expect(merged.get("00237:6")).toBe(1120);
    expect(merged.get("00237:7")).toBe(1400);
    expect(merged.get("00237:8")).toBe(1120);
  });

  it("adds multiple receipts for the same student-month across batches", () => {
    const prior = { "00001": { 9: 500 } };
    const batch = new Map<string, number>([["00001:9", 300]]);
    expect(mergeZohoBatchTotals(prior, batch).get("00001:9")).toBe(800);
  });
});

describe("monthAmountMapFromKeyMap", () => {
  it("groups student:month keys", () => {
    const map = new Map<string, number>([
      ["00237:5", 1400],
      ["00237:10", 1600],
    ]);
    expect(monthAmountMapFromKeyMap(map)).toEqual({
      "00237": { 5: 1400, 10: 1600 },
    });
  });
});
