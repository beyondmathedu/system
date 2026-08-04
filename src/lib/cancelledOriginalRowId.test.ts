import { describe, expect, it } from "vitest";
import {
  buildCancelledOriginalRowId,
  parseCancelledOriginalRowId,
} from "@/lib/lessonScheduleVersions";
import {
  buildStudentScheduleRows,
  type StudentScheduleMapperState,
} from "@/lib/studentScheduleRowMapper";
import type { YearLessonRecord } from "@/lib/yearScheduleCore";

const YEAR = 2026;

function emptyState(): StudentScheduleMapperState {
  return {
    hiddenDates: {},
    overrides: {},
    rescheduleEntries: [],
    extraEntries: [],
  };
}

describe("cancelled original row ids", () => {
  it("parses legacy and slotted cancelled row ids", () => {
    expect(parseCancelledOriginalRowId("cancelled-1784534987445-2026-07-04")).toEqual({
      entryId: "1784534987445",
      fromDate: "2026-07-04",
      slotKey: "",
    });
    expect(
      parseCancelledOriginalRowId("cancelled-1784534987445-double-reschedule-2026-07-04-rule-a"),
    ).toEqual({
      entryId: "1784534987445-double-reschedule",
      fromDate: "2026-07-04",
      slotKey: "rule-a",
    });
    expect(buildCancelledOriginalRowId("rs-1", "2026-07-04", "rule-a")).toBe(
      "cancelled-rs-1-2026-07-04-rule-a",
    );
  });

  it("keeps unique cancelled rowIds when two lessons share a fromDate", () => {
    const records: YearLessonRecord[] = [
      {
        id: "rule-a",
        effectiveDate: "2026-05-01",
        weekday: "六",
        time: "10:00 AM",
        room: "B",
        createdAt: 1,
      },
      {
        id: "rule-b",
        effectiveDate: "2026-05-01",
        weekday: "六",
        time: "11:30 AM",
        room: "Hope",
        createdAt: 2,
      },
    ];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "1784534987445",
      fromDate: "2026-07-04",
      toDate: "2026-07-11",
      time: "10:00 AM",
      room: "B",
    });

    const rows = buildStudentScheduleRows(records, state, YEAR, "2026-07-15", { month: 7 });
    const cancelled = rows.filter(
      (r) => r.date === "2026-07-04" && r.rowKind === "cancelled_original",
    );
    expect(cancelled).toHaveLength(2);
    const ids = cancelled.map((r) => r.rowId);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.startsWith("cancelled-1784534987445-2026-07-04-"))).toBe(true);
  });
});
