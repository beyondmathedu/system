import { describe, expect, it } from "vitest";
import {
  attendanceAfterRescheduleDelete,
  buildCancelledOriginalRowId,
  deleteRescheduleEntryAndAttendance,
  deleteExtraEntryAndAttendance,
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

  it("keeps unique cancelled rowIds when two slotted lessons share a fromDate", () => {
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
    // Same calendar day with two regulars: each cancel needs its own from-slot.
    state.rescheduleEntries.push(
      {
        id: "1784534987445",
        fromDate: "2026-07-04",
        toDate: "2026-07-11",
        time: "10:00 AM",
        room: "B",
        fromScheduleRuleId: "rule-a",
        fromTime: "10:00 AM",
        fromRoom: "B",
      },
      {
        id: "1784534987445-b",
        fromDate: "2026-07-04",
        toDate: "2026-07-18",
        time: "11:30 AM",
        room: "Hope",
        fromScheduleRuleId: "rule-b",
        fromTime: "11:30 AM",
        fromRoom: "Hope",
      },
    );

    const rows = buildStudentScheduleRows(records, state, YEAR, "2026-07-15", { month: 7 });
    const cancelled = rows.filter(
      (r) => r.date === "2026-07-04" && r.rowKind === "cancelled_original",
    );
    expect(cancelled).toHaveLength(2);
    const ids = cancelled.map((r) => r.rowId);
    expect(new Set(ids).size).toBe(2);
    expect(ids.some((id) => id.startsWith("cancelled-1784534987445-2026-07-04-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("cancelled-1784534987445-b-2026-07-04-"))).toBe(true);
  });

  it("restores marked reschedule attendance back to the original regular lesson on delete", () => {
    const next = attendanceAfterRescheduleDelete(
      {
        "reschedule:rs-1": true,
      },
      {
        id: "rs-1",
        fromDate: "2026-07-26",
        fromScheduleRuleId: "rule-sat",
        fromTime: "03:00 PM",
        fromRoom: "B",
      },
    );

    expect(next).toEqual({
      "regular:rule-sat:2026-07-26": true,
    });
  });

  it("removes deleted reschedule attendance without creating a regular mark when it was unticked", () => {
    const next = attendanceAfterRescheduleDelete(
      {
        "reschedule:rs-1": false,
      },
      {
        id: "rs-1",
        fromDate: "2026-07-26",
        fromScheduleRuleId: "rule-sat",
      },
    );

    expect(next).toEqual({});
  });

  it("deletes a regular reschedule and restores the original lesson as regular", () => {
    const next = deleteRescheduleEntryAndAttendance(
      {
        "reschedule:rs-1": true,
      },
      [
        {
          id: "rs-1",
          fromDate: "2026-07-26",
          toDate: "2026-08-29",
          time: "03:00 PM",
          room: "B",
          fromScheduleRuleId: "rule-sat",
          fromTime: "03:00 PM",
          fromRoom: "B",
        },
      ],
      "rs-1",
    );

    expect(next.attendance).toEqual({});
    expect(next.rescheduleEntries).toEqual([]);
  });

  it("deletes an already-pending reschedule entry completely", () => {
    const next = deleteRescheduleEntryAndAttendance(
      {},
      [
        {
          id: "rs-pending",
          fromDate: "2026-07-26",
          toDate: "",
          time: "03:00 PM",
          room: "B",
          pending: true,
        },
      ],
      "rs-pending",
    );

    expect(next.attendance).toEqual({});
    expect(next.rescheduleEntries).toEqual([]);
  });

  it("restores a moved extra back to its original slot as extra", () => {
    const next = deleteExtraEntryAndAttendance(
      {
        "extra:ex-1": true,
      },
      [
        {
          id: "ex-1",
          date: "2026-08-29",
          time: "03:00 PM",
          room: "B",
          originDate: "2026-07-26",
          originTime: "03:00 PM",
          originRoom: "B",
        },
      ],
      "ex-1",
    );

    expect(next.attendance).toEqual({});
    expect(next.extraEntries).toEqual([
      {
        id: "ex-1",
        date: "2026-07-26",
        time: "03:00 PM",
        room: "B",
      },
    ]);
  });

  it("restores an unticked moved extra as extra without attendance", () => {
    const next = deleteExtraEntryAndAttendance(
      {},
      [
        {
          id: "ex-1",
          date: "2026-08-29",
          time: "03:00 PM",
          room: "B",
          originDate: "2026-07-26",
          originTime: "03:00 PM",
          originRoom: "B",
        },
      ],
      "ex-1",
    );

    expect(next.attendance).toEqual({});
    expect(next.extraEntries).toEqual([
      {
        id: "ex-1",
        date: "2026-07-26",
        time: "03:00 PM",
        room: "B",
      },
    ]);
  });
});
