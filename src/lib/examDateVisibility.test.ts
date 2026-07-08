import { describe, expect, it } from "vitest";
import {
  formatVisibleExamDateSlashed,
  isUpcomingExamDate,
  visibleExamContent,
  visibleExamDateIso,
} from "./examDateVisibility";

describe("examDateVisibility", () => {
  const today = "2026-07-08";

  it("treats today and future as upcoming", () => {
    expect(isUpcomingExamDate("2026-07-08", today)).toBe(true);
    expect(isUpcomingExamDate("2026-07-09", today)).toBe(true);
  });

  it("hides past exam dates", () => {
    expect(isUpcomingExamDate("2026-07-07", today)).toBe(false);
    expect(visibleExamDateIso("2026-07-07", today)).toBe("");
    expect(formatVisibleExamDateSlashed("2026-07-07", today)).toBe("");
  });

  it("formats upcoming dates as M/D", () => {
    expect(formatVisibleExamDateSlashed("2026-07-15", today)).toBe("7/15");
  });

  it("hides exam content when date has passed", () => {
    expect(visibleExamContent("2026-07-07", "Mid-term", today)).toBe("");
    expect(visibleExamContent("2026-07-15", "Mid-term", today)).toBe("Mid-term");
  });
});
