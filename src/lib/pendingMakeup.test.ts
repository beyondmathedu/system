import { describe, expect, it } from "vitest";
import {
  formatPendingMakeupReminder,
  formatPendingMakeupReminderZh,
  getPendingMakeupPhase,
  isPendingMakeupEditable,
  isPendingMakeupVisible,
  pendingMakeupHideStartIso,
  pendingMakeupLockStartIso,
  pendingMakeupOpenUntilEndIso,
} from "@/lib/pendingMakeup";

describe("pendingMakeup month window", () => {
  it("May original lesson → open until 30 Jun, lock 1 Jul, hide 1 Aug", () => {
    expect(pendingMakeupOpenUntilEndIso("2026-05-12")).toBe("2026-06-30");
    expect(pendingMakeupLockStartIso("2026-05-12")).toBe("2026-07-01");
    expect(pendingMakeupHideStartIso("2026-05-12")).toBe("2026-08-01");
  });

  it("phases for May leave", () => {
    expect(getPendingMakeupPhase("2026-05-25", "2026-06-30")).toBe("open");
    expect(getPendingMakeupPhase("2026-05-25", "2026-07-01")).toBe("locked");
    expect(getPendingMakeupPhase("2026-05-25", "2026-07-15")).toBe("locked");
    expect(getPendingMakeupPhase("2026-05-25", "2026-08-01")).toBe("hidden");
  });

  it("editable / visible helpers stay open after advisory deadline", () => {
    expect(isPendingMakeupEditable("2026-05-25", "2026-06-15")).toBe(true);
    expect(isPendingMakeupEditable("2026-05-25", "2026-07-15")).toBe(true);
    expect(isPendingMakeupEditable("2026-05-25", "2026-08-01")).toBe(true);
    expect(isPendingMakeupVisible("2026-05-25", "2026-07-15")).toBe(true);
    expect(isPendingMakeupVisible("2026-05-25", "2026-08-01")).toBe(true);
  });

  it("labels: open vs locked", () => {
    expect(formatPendingMakeupReminder("2026-05-25", "2026-06-10")).toBe(
      "Makeup until end of June",
    );
    expect(formatPendingMakeupReminderZh("2026-05-25", "2026-06-10")).toBe("可補至 6 月底");
    expect(formatPendingMakeupReminder("2026-05-25", "2026-07-15")).toBe(
      "Reschedule deadline passed",
    );
    expect(formatPendingMakeupReminderZh("2026-05-25", "2026-07-15")).toBe("已過補堂限期");
  });

  it("December original → open until end of January next year", () => {
    expect(pendingMakeupOpenUntilEndIso("2026-12-05")).toBe("2027-01-31");
    expect(pendingMakeupLockStartIso("2026-12-05")).toBe("2027-02-01");
    expect(pendingMakeupHideStartIso("2026-12-05")).toBe("2027-03-01");
    expect(formatPendingMakeupReminder("2026-12-05", "2027-01-10")).toBe(
      "Makeup until end of January",
    );
  });
});
