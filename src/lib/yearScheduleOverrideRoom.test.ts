import { describe, expect, it } from "vitest";
import { lessonOverrideSlotKey } from "@/lib/lessonDayOverrides";
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

describe("room override vs schedule version", () => {
  it("override room on Jul 24 wins over Door schedule rule", () => {
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

  it("allows different room overrides for morning and afternoon on the same day", () => {
    const records: YearLessonRecord[] = [
      {
        id: "am",
        effectiveDate: "2026-11-03",
        weekday: "二",
        time: "10:00 AM",
        room: "Hope",
        createdAt: 1,
      },
      {
        id: "pm",
        effectiveDate: "2026-11-03",
        weekday: "二",
        time: "04:30 PM",
        room: "Hope",
        createdAt: 2,
      },
    ];
    const state = emptyState();
    state.overrides[lessonOverrideSlotKey("am", "2026-11-03")] = { room: "A" };
    state.overrides[lessonOverrideSlotKey("pm", "2026-11-03")] = { room: "B" };
    const rows = buildYearScheduleRowsForMonth(records, state, 2026, 11).filter(
      (r) => r.date === "2026-11-03",
    );
    expect(rows.find((r) => r.time === "10:00 AM")?.room).toBe("A");
    expect(rows.find((r) => r.time === "04:30 PM")?.room).toBe("B");
  });
});
