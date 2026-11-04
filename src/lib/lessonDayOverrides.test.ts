import { describe, expect, it } from "vitest";
import {
  clearLessonSlotOrDateOverride,
  lessonOverrideIdForRow,
  lessonOverrideRescheduleId,
  lessonOverrideSlotKey,
  overrideDateIsoFromKey,
  resolveLessonOverride,
  scrubSmearedTutorFromRoomBearingSlotOverrides,
  upsertLessonSlotOrDateOverride,
} from "./lessonDayOverrides";

describe("lessonDayOverrides", () => {
  it("prefers slot override over legacy date override", () => {
    const overrides = {
      "2026-11-03": { room: "A" },
      [lessonOverrideSlotKey("rule-am", "2026-11-03")]: { room: "B" },
    };
    expect(
      resolveLessonOverride(overrides, { dateIso: "2026-11-03", scheduleRuleId: "rule-am" })?.room,
    ).toBe("B");
    expect(
      resolveLessonOverride(overrides, { dateIso: "2026-11-03", scheduleRuleId: "rule-pm" })?.room,
    ).toBe("A");
  });

  it("splits a legacy date override when writing a slot room change without copying tutor", () => {
    const next = upsertLessonSlotOrDateOverride(
      { "2026-11-03": { room: "A", tutor: "Leo" } },
      {
        dateIso: "2026-11-03",
        scheduleRuleId: "rule-pm",
        patch: { room: "B" },
        otherScheduleRuleIdsOnDate: ["rule-am", "rule-pm"],
      },
    );
    expect(next["2026-11-03"]).toBeUndefined();
    expect(next[lessonOverrideSlotKey("rule-am", "2026-11-03")]).toEqual({
      room: "A",
    });
    // Focus keeps the date-wide tutor so a room-only edit does not become 待定.
    expect(next[lessonOverrideSlotKey("rule-pm", "2026-11-03")]).toEqual({
      room: "B",
      tutor: "Leo",
    });
  });

  it("preserves date-wide tutor/summary on a Band reschedule room edit; scrub clears Hope smear", () => {
    const rsId = lessonOverrideRescheduleId("entry-dora");
    const afterRoomEdit = upsertLessonSlotOrDateOverride(
      {
        "2026-10-10": {
          tutor: "Li",
          lessonSummary: "CIA quadratic\nQuadratic II QT",
          room: "Hope",
        },
      },
      {
        dateIso: "2026-10-10",
        scheduleRuleId: rsId,
        patch: { room: "Band" },
        otherScheduleRuleIdsOnDate: [rsId, "hope-pm"],
      },
    );
    expect(afterRoomEdit[lessonOverrideSlotKey(rsId, "2026-10-10")]).toEqual({
      room: "Band",
      tutor: "Li",
      lessonSummary: "CIA quadratic\nQuadratic II QT",
    });
    expect(afterRoomEdit[lessonOverrideSlotKey("hope-pm", "2026-10-10")]).toEqual({
      room: "Hope",
    });

    // Simulate older smear: Band kept only room; Hope stuck with date-wide Li + note.
    const smeared = {
      [lessonOverrideSlotKey(rsId, "2026-10-10")]: { room: "Band" },
      [lessonOverrideSlotKey("hope-pm", "2026-10-10")]: {
        tutor: "Li",
        lessonSummary: "CIA quadratic\nQuadratic II QT",
      },
    };
    const scrubbed = scrubSmearedTutorFromRoomBearingSlotOverrides(smeared);
    expect(scrubbed[lessonOverrideSlotKey(rsId, "2026-10-10")]).toEqual({
      room: "Band",
      tutor: "Li",
      lessonSummary: "CIA quadratic\nQuadratic II QT",
    });
    expect(scrubbed[lessonOverrideSlotKey("hope-pm", "2026-10-10")]?.tutor).toBeUndefined();
    expect(scrubbed[lessonOverrideSlotKey("hope-pm", "2026-10-10")]?.lessonSummary).toBeUndefined();
  });

  it("clears only the focused slot after materializing legacy date override", () => {
    const next = clearLessonSlotOrDateOverride(
      { "2026-11-03": { room: "A" } },
      {
        dateIso: "2026-11-03",
        scheduleRuleId: "rule-pm",
        otherScheduleRuleIdsOnDate: ["rule-am", "rule-pm"],
      },
    );
    expect(next["2026-11-03"]).toBeUndefined();
    expect(next[lessonOverrideSlotKey("rule-am", "2026-11-03")]).toEqual({ room: "A" });
    expect(next[lessonOverrideSlotKey("rule-pm", "2026-11-03")]).toBeUndefined();
  });

  it("parses date from slot keys", () => {
    expect(overrideDateIsoFromKey("2026-11-03")).toBe("2026-11-03");
    expect(overrideDateIsoFromKey(lessonOverrideSlotKey("abc", "2026-11-03"))).toBe("2026-11-03");
    expect(overrideDateIsoFromKey("nope")).toBeNull();
  });

  it("keeps reschedule and regular tutor/summary overrides independent on the same day", () => {
    const rsId = lessonOverrideRescheduleId("entry-1");
    const next = upsertLessonSlotOrDateOverride(
      { "2026-10-10": { tutor: "Li", lessonSummary: "shared old", room: "Hope" } },
      {
        dateIso: "2026-10-10",
        scheduleRuleId: rsId,
        patch: { tutor: "Matthew", lessonSummary: "Band only" },
        otherScheduleRuleIdsOnDate: [rsId, "rule-pm"],
      },
    );
    expect(
      resolveLessonOverride(next, { dateIso: "2026-10-10", scheduleRuleId: rsId })?.tutor,
    ).toBe("Matthew");
    // Sibling only gets room/time from legacy — not tutor — so Room Slot Tutor can apply.
    expect(
      resolveLessonOverride(next, {
        dateIso: "2026-10-10",
        scheduleRuleId: "rule-pm",
        allowDateFallback: false,
      })?.tutor,
    ).toBeUndefined();
    expect(next[lessonOverrideSlotKey("rule-pm", "2026-10-10")]).toEqual({ room: "Hope" });
    expect(
      resolveLessonOverride(next, {
        dateIso: "2026-10-10",
        scheduleRuleId: rsId,
      })?.lessonSummary,
    ).toBe("Band only");
    expect(lessonOverrideIdForRow({ rescheduleEntryId: "entry-1" })).toBe(rsId);
  });

  it("does not smear a date-wide tutor onto another slot when date fallback is disabled", () => {
    const overrides = { "2026-10-10": { tutor: "Li" } };
    expect(
      resolveLessonOverride(overrides, {
        dateIso: "2026-10-10",
        scheduleRuleId: "hope-door-pm",
        allowDateFallback: false,
      })?.tutor,
    ).toBeUndefined();
    expect(
      resolveLessonOverride(overrides, {
        dateIso: "2026-10-10",
        scheduleRuleId: "hope-door-pm",
        allowDateFallback: true,
      })?.tutor,
    ).toBe("Li");
  });
});
