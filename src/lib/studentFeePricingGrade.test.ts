import { describe, expect, it } from "vitest";
import {
  buildSlotPricesInLOrder,
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
