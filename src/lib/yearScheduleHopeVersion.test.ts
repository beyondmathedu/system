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

describe("Hope room change across schedule versions", () => {
  it("uses Door on Jul 24 and Shelf on Jul 31 when versions change on Jul 24/25", () => {
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
    const rows = buildYearScheduleRowsForMonth(records, emptyState(), 2026, 7);
    const jul24 = rows.filter((r) => r.date === "2026-07-24");
    const jul31 = rows.filter((r) => r.date === "2026-07-31");
    expect(jul24.map((r) => r.room)).toEqual(["Hope"]);
    expect(jul31.map((r) => r.room)).toEqual(["Hope 2"]);
  });

  it("keeps display-name rooms on the correct dates", () => {
    const records: YearLessonRecord[] = [
      {
        id: "door",
        effectiveDate: "2026-07-24",
        weekday: "五",
        time: "04:30 PM",
        room: "Hope - Door",
        createdAt: 1,
      },
      {
        id: "shelf",
        effectiveDate: "2026-07-25",
        weekday: "五",
        time: "04:30 PM",
        room: "Hope - Shelf",
        createdAt: 2,
      },
    ];
    const rows = buildYearScheduleRowsForMonth(records, emptyState(), 2026, 7);
    const jul24 = rows.filter((r) => r.date === "2026-07-24");
    const jul31 = rows.filter((r) => r.date === "2026-07-31");
    expect(jul24.map((r) => r.room)).toEqual(["Hope - Door"]);
    expect(jul31.map((r) => r.room)).toEqual(["Hope - Shelf"]);
  });
});
