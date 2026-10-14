import { describe, expect, it } from "vitest";
import { shouldBlankInactiveTutorForDate } from "@/lib/tutorVisibilityCore";

describe("shouldBlankInactiveTutorForDate", () => {
  it("legacy Set: keeps past/today, blanks only future vs today", () => {
    const inactive = new Set(["Kelly", "凱莉"]);
    expect(shouldBlankInactiveTutorForDate(inactive, "Kelly", "2026-10-01", "2026-10-14")).toBe(
      false,
    );
    expect(shouldBlankInactiveTutorForDate(inactive, "Kelly", "2026-10-14", "2026-10-14")).toBe(
      false,
    );
    expect(shouldBlankInactiveTutorForDate(inactive, "Kelly", "2026-10-15", "2026-10-14")).toBe(
      true,
    );
  });

  it("Map leave date: blanks on/after leave-from, keeps earlier lessons", () => {
    const leaveByName = new Map([
      ["Kelly", "2026-09-01"],
      ["凱莉", "2026-09-01"],
    ]);
    expect(shouldBlankInactiveTutorForDate(leaveByName, "Kelly", "2026-08-31", "2026-10-14")).toBe(
      false,
    );
    expect(shouldBlankInactiveTutorForDate(leaveByName, "Kelly", "2026-09-01", "2026-10-14")).toBe(
      true,
    );
    expect(shouldBlankInactiveTutorForDate(leaveByName, "Kelly", "2026-10-01", "2026-10-14")).toBe(
      true,
    );
  });

  it("Map with empty leave date falls back to today rule", () => {
    const leaveByName = new Map([["Kelly", ""]]);
    expect(shouldBlankInactiveTutorForDate(leaveByName, "Kelly", "2026-10-14", "2026-10-14")).toBe(
      false,
    );
    expect(shouldBlankInactiveTutorForDate(leaveByName, "Kelly", "2026-10-15", "2026-10-14")).toBe(
      true,
    );
  });

  it("does not blank active tutors", () => {
    const leaveByName = new Map([["Kelly", "2026-09-01"]]);
    expect(shouldBlankInactiveTutorForDate(leaveByName, "Pammi", "2026-12-01", "2026-10-14")).toBe(
      false,
    );
  });
});
