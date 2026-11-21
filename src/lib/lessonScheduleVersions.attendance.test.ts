import { describe, expect, it } from "vitest";
import {
  isScheduleAttendanceMarked,
  sanitizeLessonAttendance,
} from "@/lib/lessonScheduleVersions";

describe("isScheduleAttendanceMarked Extra/Reschedule defense", () => {
  it("reads Extra via extra: key even when scheduleRuleId is ex: (student-page bug)", () => {
    const attendance = { "extra:abc": true };
    expect(
      isScheduleAttendanceMarked(attendance, {
        attendanceKey: "extra:abc",
        dateIso: "2026-11-14",
        lessonType: "加堂",
        scheduleRuleId: "ex:abc",
      }),
    ).toBe(true);
    // If a caller wrongly labels Extra as Regular, still use attendanceKey — not regular:ex:.
    expect(
      isScheduleAttendanceMarked(attendance, {
        attendanceKey: "extra:abc",
        dateIso: "2026-11-14",
        lessonType: "恆常",
        scheduleRuleId: "ex:abc",
      }),
    ).toBe(true);
  });

  it("does not treat Cancelled as attended even when shared extra key is true", () => {
    const attendance = { "extra:abc": true };
    expect(
      isScheduleAttendanceMarked(attendance, {
        attendanceKey: "extra:abc",
        dateIso: "2026-10-01",
        lessonType: "取消",
        scheduleRuleId: "ex:abc",
      }),
    ).toBe(false);
  });
});

describe("sanitizeLessonAttendance", () => {
  it("migrates bare date ticks to regular:id:date and drops cancelled/orphan keys", () => {
    const { attendance, changes } = sanitizeLessonAttendance(
      {
        "2026-05-04": true,
        "cancelled:2026-06-16:1": true,
        "extra:gone": true,
        "extra:keep": true,
        "reschedule:gone": true,
        "regular:old-rule:2026-07-01": true,
        "regular:live-rule:2026-08-01": true,
        "regular:ex:oops": true,
      },
      {
        knownRuleIds: ["live-rule"],
        liveKeys: ["regular:live-rule:2026-08-01", "extra:keep"],
        regularSlots: [{ ruleId: "live-rule", dateIso: "2026-05-04" }],
        extraEntryIds: ["keep"],
        rescheduleEntryIds: [],
      },
    );

    expect(attendance["2026-05-04"]).toBeUndefined();
    expect(attendance["regular:live-rule:2026-05-04"]).toBe(true);
    expect(attendance["regular:live-rule:2026-08-01"]).toBe(true);
    expect(attendance["extra:keep"]).toBe(true);
    expect(attendance["extra:gone"]).toBeUndefined();
    expect(attendance["reschedule:gone"]).toBeUndefined();
    expect(attendance["cancelled:2026-06-16:1"]).toBeUndefined();
    expect(attendance["regular:old-rule:2026-07-01"]).toBeUndefined();
    expect(attendance["regular:ex:oops"]).toBeUndefined();
    expect(changes.length).toBeGreaterThan(0);
  });
});
