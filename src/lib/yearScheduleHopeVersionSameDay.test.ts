import { describe, expect, it } from "vitest";
import {
  buildYearScheduleRowsForMonth,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";

function emptyState(): YearLessonState {
  return {
    attendance: {},
    hiddenDates: {},
    overrides: {},
    rescheduleEntries: [],
    extraEntries: [],
  };
}

describe("Hope version edge cases for 00339-like data", () => {
  it("same effectiveDate Door+Shelf keeps both rooms as separate slots", () => {
    const records: YearLessonRecord[] = [
      {
        id: "door",
        effectiveDate: "2026-07-24",
        weekday: "五",
        time: "04:30 PM",
        room: "Hope",
        createdAt: 1,
      },
      {
        id: "shelf",
        effectiveDate: "2026-07-24",
        weekday: "五",
        time: "04:30 PM",
        room: "Hope 2",
        createdAt: 2,
      },
    ];
    const rows = buildYearScheduleRowsForMonth(records, emptyState(), 2026, 7);
    const jul24 = rows.filter((r) => r.date === "2026-07-24").map((r) => r.room);
    expect(jul24.sort()).toEqual(["Hope", "Hope 2"]);
  });

  it("override Shelf on Jul 24 explains both Fridays showing Shelf", () => {
    const records: YearLessonRecord[] = [
      {
        id: "door",
        effectiveDate: "2026-07-24",
        weekday: "五",
        time: "04:30 PM",
        room: "Hope",
        createdAt: 1,
      },
      {
        id: "shelf",
        effectiveDate: "2026-07-25",
        weekday: "五",
        time: "04:30 PM",
        room: "Hope 2",
        createdAt: 2,
      },
    ];
    const state = emptyState();
    state.overrides["2026-07-24"] = { room: "Hope 2" };
    const rows = buildYearScheduleRowsForMonth(records, state, 2026, 7);
    expect(rows.find((r) => r.date === "2026-07-24")?.room).toBe("Hope 2");
    expect(rows.find((r) => r.date === "2026-07-31")?.room).toBe("Hope 2");
  });
});
