import { describe, expect, it } from "vitest";
import { buildZohoSyncWindow } from "@/lib/zohoSyncWindow";

describe("buildZohoSyncWindow", () => {
  it("looks back to Jan 1 so Jul-dated receipts are included when syncing Sep", () => {
    expect(buildZohoSyncWindow(2026, 9, false)).toEqual({
      dateStart: "2026-01-01",
      dateEnd: "2026-10-31",
    });
  });

  it("still ends at target month + 1", () => {
    expect(buildZohoSyncWindow(2026, 8, false)).toEqual({
      dateStart: "2026-01-01",
      dateEnd: "2026-09-30",
    });
  });

  it("widens to full calendar year when requested", () => {
    expect(buildZohoSyncWindow(2026, 9, true)).toEqual({
      dateStart: "2026-01-01",
      dateEnd: "2026-12-31",
    });
  });
});
