import { describe, expect, it } from "vitest";
import {
  isEmptyLessonYearState,
  mergeYearStateWithLegacyFallback,
  mergeYearStatesBatchWithLegacyFallback,
  studentIdsNeedingLegacyStateFallback,
} from "@/lib/lessonYearStateLegacy";
import { DEFAULT_LESSON_YEAR_STATE } from "@/lib/lessonYearStateShared";

describe("lessonYearStateLegacy", () => {
  it("treats missing keys as empty", () => {
    expect(isEmptyLessonYearState(undefined)).toBe(true);
    expect(isEmptyLessonYearState(DEFAULT_LESSON_YEAR_STATE)).toBe(true);
  });

  it("prefers non-empty year row over legacy for 2026", () => {
    const yearState = {
      ...DEFAULT_LESSON_YEAR_STATE,
      attendance: { "2026-05-01": true },
    };
    const legacy = {
      ...DEFAULT_LESSON_YEAR_STATE,
      attendance: { "2026-05-02": true },
    };
    expect(mergeYearStateWithLegacyFallback(yearState, legacy, 2026)).toEqual(yearState);
  });

  it("falls back to legacy when year row is empty for 2026", () => {
    const legacy = {
      ...DEFAULT_LESSON_YEAR_STATE,
      hiddenDates: { "2026-05-01": true },
    };
    expect(
      mergeYearStateWithLegacyFallback(DEFAULT_LESSON_YEAR_STATE, legacy, 2026),
    ).toEqual(legacy);
  });

  it("does not use legacy fallback for other years", () => {
    const legacy = {
      ...DEFAULT_LESSON_YEAR_STATE,
      attendance: { "2027-01-01": true },
    };
    expect(
      mergeYearStateWithLegacyFallback(DEFAULT_LESSON_YEAR_STATE, legacy, 2027),
    ).toEqual(DEFAULT_LESSON_YEAR_STATE);
  });

  it("batch merge fills empty ids from legacy", () => {
    const legacy = {
      s1: { ...DEFAULT_LESSON_YEAR_STATE, attendance: { a: true } },
    };
    const merged = mergeYearStatesBatchWithLegacyFallback(
      ["s1", "s2"],
      2026,
      {},
      legacy,
    );
    expect(merged.s1.attendance).toEqual({ a: true });
    expect(merged.s2).toEqual(DEFAULT_LESSON_YEAR_STATE);
    expect(studentIdsNeedingLegacyStateFallback(["s1"], {}, 2026)).toEqual(["s1"]);
    expect(studentIdsNeedingLegacyStateFallback(["s1"], {}, 2027)).toEqual([]);
  });
});
