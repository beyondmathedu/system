import { describe, expect, it } from "vitest";
import {
  availableLessonYears,
  defaultLessonYear,
  lessonYearPickerMax,
  MIN_LESSON_YEAR,
  parseLessonYear,
} from "@/lib/lessonCalendar";

describe("lessonCalendar", () => {
  it("defaults to HK calendar year when on or after min year", () => {
    const now = new Date("2027-03-15T12:00:00+08:00");
    expect(defaultLessonYear(now)).toBe(2027);
    expect(lessonYearPickerMax(now)).toBe(2027);
  });

  it("opens next year from 1 Dec HK", () => {
    const now = new Date("2026-12-01T12:00:00+08:00");
    expect(lessonYearPickerMax(now)).toBe(2027);
    expect(availableLessonYears(now)).toContain(2027);
  });

  it("clamps parseLessonYear to valid range", () => {
    expect(parseLessonYear("2025", 2026)).toBe(2026);
    expect(parseLessonYear("2028", 2026)).toBe(2028);
    expect(parseLessonYear("bad", 2026)).toBe(2026);
  });

  it("starts available years at MIN_LESSON_YEAR", () => {
    expect(MIN_LESSON_YEAR).toBe(2026);
    expect(availableLessonYears(new Date("2027-06-01T12:00:00+08:00"))[0]).toBe(2026);
  });
});
