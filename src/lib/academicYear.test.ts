import { describe, expect, it } from "vitest";
import {
  academicYearStartYear,
  formatAcademicYearId,
  getAcademicYear,
  getAcademicYearForMonth,
  getCurrentAcademicYear,
} from "@/lib/academicYear";

describe("getAcademicYear", () => {
  it("splits on Sept 1", () => {
    expect(getAcademicYear("2026-08-31")).toBe("2025-26");
    expect(getAcademicYear("2026-09-01")).toBe("2026-27");
    expect(getAcademicYear("2027-08-31")).toBe("2026-27");
    expect(getAcademicYear("2027-09-01")).toBe("2027-28");
  });
});

describe("getAcademicYearForMonth", () => {
  it("maps fee sheet months", () => {
    expect(getAcademicYearForMonth(2026, 5)).toBe("2025-26");
    expect(getAcademicYearForMonth(2026, 8)).toBe("2025-26");
    expect(getAcademicYearForMonth(2026, 9)).toBe("2026-27");
    expect(getAcademicYearForMonth(2026, 12)).toBe("2026-27");
  });
});

describe("format / parse", () => {
  it("round-trips start year", () => {
    expect(formatAcademicYearId(2026)).toBe("2026-27");
    expect(academicYearStartYear("2026-27")).toBe(2026);
    expect(academicYearStartYear("2026-28")).toBeNull();
  });

  it("returns a current academic year string", () => {
    expect(getCurrentAcademicYear(new Date("2026-10-01T04:00:00Z"))).toBe("2026-27");
    expect(getCurrentAcademicYear(new Date("2026-05-01T04:00:00Z"))).toBe("2025-26");
  });
});
