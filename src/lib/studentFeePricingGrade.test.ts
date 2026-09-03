import { describe, expect, it } from "vitest";
import {
  buildSlotPricesInLOrder,
  inferGradeAtSheetEnd,
  inferGradeOnDate,
  sumSlotTuitionHkdByLessonCount,
  sumSlotTuitionHkdFromDates,
} from "@/lib/studentFeePricingGrade";
import type { StudentFeeTierSettings } from "@/lib/studentFeeTierSettings";

const tier: StudentFeeTierSettings = {
  f_low_tier_1_8: 270,
  f_low_tier_9_plus: 250,
  f_high_tier_1_8: 320,
  f_high_tier_9_plus: 300,
  lesson_tier_break_after: 8,
};

describe("monthly threshold tuition", () => {
  it("≤7 lessons: all Normal", () => {
    expect(sumSlotTuitionHkdByLessonCount({ lessonCount: 7, gradeFor: "F2", feeTierSettings: tier })).toBe(
      7 * 270,
    );
    expect(sumSlotTuitionHkdByLessonCount({ lessonCount: 4, gradeFor: "F5", feeTierSettings: tier })).toBe(
      4 * 320,
    );
  });

  it("≥8 lessons: all Discount", () => {
    expect(sumSlotTuitionHkdByLessonCount({ lessonCount: 8, gradeFor: "F2", feeTierSettings: tier })).toBe(
      8 * 250,
    );
    expect(sumSlotTuitionHkdByLessonCount({ lessonCount: 10, gradeFor: "F2", feeTierSettings: tier })).toBe(
      10 * 250,
    );
  });

  it("dated slots match count rule", () => {
    const seven = ["1/5", "2/5", "3/5", "4/5", "5/5", "6/5", "7/5"];
    expect(buildSlotPricesInLOrder(seven, "F2", tier)).toEqual(Array(7).fill(270));
    expect(sumSlotTuitionHkdFromDates({ fullLessonDates: seven, gradeFor: "F2", feeTierSettings: tier })).toBe(
      7 * 270,
    );

    const eight = [...seven, "8/5"];
    expect(buildSlotPricesInLOrder(eight, "F2", tier)).toEqual(Array(8).fill(250));
    expect(sumSlotTuitionHkdFromDates({ fullLessonDates: eight, gradeFor: "F2", feeTierSettings: tier })).toBe(
      8 * 250,
    );
  });
});

describe("inferGradeAtSheetEnd after 1 Sept promotion", () => {
  it("rolls current F.4 back to F.3 for August 2026", () => {
    expect(inferGradeAtSheetEnd("F.4", 2026, 8)).toBe("F3");
    expect(inferGradeAtSheetEnd("F4", 2026, 9)).toBe("F4");
  });

  it("maps each current form to the pre-Sept form for May–August 2026", () => {
    const before = [5, 6, 7, 8] as const;
    for (const month of before) {
      expect(inferGradeAtSheetEnd("F2", 2026, month)).toBe("F1");
      expect(inferGradeAtSheetEnd("F3", 2026, month)).toBe("F2");
      expect(inferGradeAtSheetEnd("F4", 2026, month)).toBe("F3");
      expect(inferGradeAtSheetEnd("F5", 2026, month)).toBe("F4");
      expect(inferGradeAtSheetEnd("F6", 2026, month)).toBe("F5");
      expect(inferGradeAtSheetEnd("F1", 2026, month)).toBe("F1");
    }
  });

  it("keeps the post-Sept form from September 2026 onward", () => {
    for (const month of [9, 10, 11, 12] as const) {
      expect(inferGradeAtSheetEnd("F2", 2026, month)).toBe("F2");
      expect(inferGradeAtSheetEnd("F3", 2026, month)).toBe("F3");
      expect(inferGradeAtSheetEnd("F4", 2026, month)).toBe("F4");
      expect(inferGradeAtSheetEnd("F5", 2026, month)).toBe("F5");
      expect(inferGradeAtSheetEnd("F6", 2026, month)).toBe("F6");
    }
  });

  it("uses the lesson date's month on inferGradeOnDate", () => {
    expect(inferGradeOnDate("F4", "2026-08-31")).toBe("F3");
    expect(inferGradeOnDate("F4", "2026-09-01")).toBe("F4");
    expect(inferGradeOnDate("F.6", "2026-06-15")).toBe("F5");
    expect(inferGradeOnDate("F.6", "2026-09-02")).toBe("F6");
  });
});
