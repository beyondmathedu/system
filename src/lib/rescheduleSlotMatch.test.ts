import { describe, expect, it } from "vitest";
import {
  buildYearScheduleRowsForMonth,
  findRescheduleForOriginalLesson,
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

describe("reschedule cancels only matching slot on same date", () => {
  const records: YearLessonRecord[] = [
    {
      id: "rule-1000",
      effectiveDate: "2026-07-01",
      weekday: "六",
      time: "10:00 AM",
      room: "B",
      createdAt: 1,
    },
    {
      id: "rule-1130",
      effectiveDate: "2026-07-01",
      weekday: "六",
      time: "11:30 AM",
      room: "B",
      createdAt: 2,
    },
  ];

  it("legacy entry without from-slot cancels all lessons only on single-slot dates", () => {
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-legacy",
      fromDate: "2026-07-04",
      toDate: "2026-07-20",
      time: "04:30 PM",
      room: "Hope",
    });
    const rows = buildYearScheduleRowsForMonth([records[0]], state, 2026, 7);
    const cancelled = rows.filter(
      (r) => r.date === "2026-07-04" && r.rowKind === "cancelled_original",
    );
    expect(cancelled).toHaveLength(1);
  });

  it("legacy entry without from-slot does not cancel when multiple lessons share the date", () => {
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-legacy",
      fromDate: "2026-07-04",
      toDate: "2026-07-20",
      time: "04:30 PM",
      room: "Hope",
    });
    const rows = buildYearScheduleRowsForMonth(records, state, 2026, 7);
    const jul4 = rows.filter((r) => r.date === "2026-07-04");
    expect(jul4.every((r) => r.rowKind === "normal")).toBe(true);
  });

  it("two slotted reschedules on the same original date stay independent", () => {
    const state = emptyState();
    state.rescheduleEntries.push(
      {
        id: "rs-1000",
        fromDate: "2026-07-04",
        toDate: "2026-08-04",
        time: "06:00 PM",
        room: "B",
        fromScheduleRuleId: "rule-1000",
        fromTime: "10:00 AM",
        fromRoom: "B",
      },
      {
        id: "rs-1130",
        fromDate: "2026-07-04",
        toDate: "2026-08-14",
        time: "06:00 PM",
        room: "B",
        fromScheduleRuleId: "rule-1130",
        fromTime: "11:30 AM",
        fromRoom: "B",
      },
    );
    const rows = buildYearScheduleRowsForMonth(records, state, 2026, 7);
    const jul4 = rows
      .filter((r) => r.date === "2026-07-04")
      .map((r) => ({ time: r.time, kind: r.rowKind }))
      .sort((a, b) => a.time.localeCompare(b.time));
    expect(jul4).toEqual([
      { time: "10:00 AM", kind: "cancelled_original" },
      { time: "11:30 AM", kind: "cancelled_original" },
    ]);
    const augustRows = buildYearScheduleRowsForMonth(records, state, 2026, 8);
    expect(augustRows.some((r) => r.date === "2026-08-04" && r.rowKind === "reschedule")).toBe(true);
    expect(augustRows.some((r) => r.date === "2026-08-14" && r.rowKind === "reschedule")).toBe(true);
  });

  it("fromScheduleRuleId cancels only that lesson", () => {
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-slot",
      fromDate: "2026-07-04",
      toDate: "2026-07-20",
      time: "04:30 PM",
      room: "Hope",
      fromScheduleRuleId: "rule-1000",
      fromTime: "10:00 AM",
      fromRoom: "B",
    });
    const rows = buildYearScheduleRowsForMonth(records, state, 2026, 7);
    const jul4 = rows.filter((r) => r.date === "2026-07-04");
    expect(jul4.map((r) => ({ time: r.time, kind: r.rowKind })).sort((a, b) => a.time.localeCompare(b.time))).toEqual([
      { time: "10:00 AM", kind: "cancelled_original" },
      { time: "11:30 AM", kind: "normal" },
    ]);
    expect(rows.some((r) => r.date === "2026-07-20" && r.rowKind === "reschedule")).toBe(true);
  });

  it("findRescheduleForOriginalLesson prefers slotted match", () => {
    const entries = [
      {
        id: "rs-slot",
        fromDate: "2026-07-04",
        toDate: "2026-07-20",
        time: "04:30 PM",
        room: "Hope",
        fromScheduleRuleId: "rule-1130",
      },
    ];
    expect(
      findRescheduleForOriginalLesson(entries, {
        date: "2026-07-04",
        time: "10:00 AM",
        room: "B",
        baseRule: { id: "rule-1000" },
      }),
    ).toBeUndefined();
    expect(
      findRescheduleForOriginalLesson(entries, {
        date: "2026-07-04",
        time: "11:30 AM",
        room: "B",
        baseRule: { id: "rule-1130" },
      })?.id,
    ).toBe("rs-slot");
  });
});
