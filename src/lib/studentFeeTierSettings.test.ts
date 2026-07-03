import { describe, expect, it } from "vitest";
import { resolveFeeTierSettingsForStudent } from "@/lib/studentFeePricingGrade";
import type { StudentFeeTierBundle } from "@/lib/studentFeeTierSettings";

const bundle: StudentFeeTierBundle = {
  legacy: {
    f_low_tier_1_8: 230,
    f_low_tier_9_plus: 210,
    f_high_tier_1_8: 280,
    f_high_tier_9_plus: 250,
    lesson_tier_break_after: 8,
  },
  current: {
    f_low_tier_1_8: 270,
    f_low_tier_9_plus: 250,
    f_high_tier_1_8: 320,
    f_high_tier_9_plus: 300,
    lesson_tier_break_after: 8,
  },
  currentPriceStudentIds: "00150\n00152",
  globalPriceSwitchDate: "2026-09-01",
};

describe("resolveFeeTierSettingsForStudent", () => {
  it("uses legacy when student is not on the whitelist", () => {
    const t = resolveFeeTierSettingsForStudent(bundle, "00149", 2026, 7);
    expect(t.f_low_tier_1_8).toBe(230);
  });

  it("uses current for listed student before switch", () => {
    const t = resolveFeeTierSettingsForStudent(bundle, "00150", 2026, 7);
    expect(t.f_low_tier_1_8).toBe(270);
  });

  it("keeps referral on legacy even with high id when not listed", () => {
    const t = resolveFeeTierSettingsForStudent(bundle, "00200", 2026, 8);
    expect(t.f_high_tier_1_8).toBe(280);
  });

  it("uses current for everyone from September sheet month", () => {
    const t = resolveFeeTierSettingsForStudent(bundle, "00001", 2026, 9);
    expect(t.f_low_tier_1_8).toBe(270);
  });

  it("accepts unpadded ids in the whitelist", () => {
    const t = resolveFeeTierSettingsForStudent(bundle, "152", 2026, 7);
    expect(t.f_low_tier_1_8).toBe(270);
  });
});
