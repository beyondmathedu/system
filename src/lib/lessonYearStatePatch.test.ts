import { describe, expect, it } from "vitest";
import {
  attendanceRecordDelta,
  buildAttendancePatchFromKeys,
  buildLessonYearStateUpsertRow,
  lessonYearStateFieldsUnchanged,
} from "@/lib/lessonYearStatePatchCore";
import {
  DEFAULT_LESSON_YEAR_STATE,
  lessonYearStateFieldsFromPatch,
} from "@/lib/lessonYearStateShared";

describe("lesson year state patch upsert", () => {
  it("builds partial row for attendance-only save", () => {
    const row = buildLessonYearStateUpsertRow(
      "S00001",
      2026,
      {
        attendance: { "regular:abc": true },
        overrides: { "2026-05-01": { tutor: "Li" } },
      },
      ["attendance"],
    );

    expect(row).toMatchObject({
      student_id: "S00001",
      year: 2026,
      attendance: { "regular:abc": true },
    });
    expect(row).not.toHaveProperty("overrides");
    expect(row).not.toHaveProperty("hidden_dates");
    expect(row).not.toHaveProperty("reschedule_entries");
    expect(row).not.toHaveProperty("extra_entries");
  });

  it("derives dirty fields from patch object keys", () => {
    expect(
      lessonYearStateFieldsFromPatch({
        overrides: { "2026-05-01": { lessonSummary: "test" } },
      }),
    ).toEqual(["overrides"]);
  });

  it("detects unchanged dirty fields", () => {
    const state = {
      ...DEFAULT_LESSON_YEAR_STATE,
      attendance: { a: true },
      overrides: { d: { tutor: "Li" } },
    };
    expect(lessonYearStateFieldsUnchanged(state, ["attendance"], state)).toBe(true);
    expect(
      lessonYearStateFieldsUnchanged(
        { ...state, attendance: { a: false } },
        ["attendance"],
        state,
      ),
    ).toBe(false);
  });

  it("builds minimal attendance RPC patch from dirty keys", () => {
    expect(
      buildAttendancePatchFromKeys(
        { "regular:abc": true, "regular:def": false },
        ["regular:abc"],
      ),
    ).toEqual({ "regular:abc": true });
  });

  it("computes attendance delta without false noise", () => {
    expect(attendanceRecordDelta({ a: false, b: true }, {})).toEqual({ b: true });
    expect(attendanceRecordDelta({ a: true }, { a: false })).toEqual({ a: true });
    expect(attendanceRecordDelta({ a: true }, { a: true })).toEqual({});
  });
});
