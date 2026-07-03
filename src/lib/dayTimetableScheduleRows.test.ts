import { describe, expect, it } from "vitest";
import { hiddenScheduleRuleStorageKey } from "@/lib/lessonScheduleHidden";
import { buildDayTimetableRowsForDate } from "@/lib/dayTimetableScheduleRows";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import { type YearLessonRecord, type YearLessonState } from "@/lib/yearScheduleCore";

function emptyState(): YearLessonState {
  return {
    attendance: {},
    hiddenDates: {},
    overrides: {},
    rescheduleEntries: [],
    extraEntries: [],
  };
}

function mondayRule(overrides: Partial<YearLessonRecord> = {}): YearLessonRecord {
  return {
    id: "rule-mon",
    effectiveDate: "2026-05-01",
    weekday: "一",
    time: "4:00 PM",
    room: "M前",
    createdAt: 1,
    ...overrides,
  };
}

describe("dayTimetableScheduleRows", () => {
  it("shows reschedule on target date for cross-month move", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });

    const rows = buildDayTimetableRowsForDate(records, state, "2026-06-03", "2026-06-01");

    expect(rows.some((r) => r.lessonType === "補堂" && r.date === "2026-06-03")).toBe(true);
    expect(rows.some((r) => r.lessonType === "取消")).toBe(false);
  });

  it("shows pending makeup on original date", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-pending",
      fromDate: "2026-05-25",
      toDate: "",
      time: "4:00 PM",
      room: "M前",
      pending: true,
    });

    const rows = buildDayTimetableRowsForDate(records, state, "2026-05-25", "2026-06-01");

    expect(rows.some((r) => r.lessonType === PENDING_MAKEUP_TYPE_LABEL)).toBe(true);
    expect(rows.some((r) => r.lessonType === "補堂")).toBe(false);
  });

  it("respects hidden_dates by rule id", () => {
    const records = [mondayRule({ id: "rule-hide-me" })];
    const state = emptyState();
    state.hiddenDates[hiddenScheduleRuleStorageKey("rule-hide-me")] = true;

    const rows = buildDayTimetableRowsForDate(records, state, "2026-05-25", "2026-05-20");

    expect(rows.some((r) => r.lessonType === "恆常")).toBe(false);
  });

  it("emits two regular rows when two rules share a weekday", () => {
    const records = [
      mondayRule({ id: "rule-a", time: "4:00 PM", room: "M前" }),
      mondayRule({ id: "rule-b", time: "5:30 PM", room: "B" }),
    ];
    const state = emptyState();

    const rows = buildDayTimetableRowsForDate(records, state, "2026-05-25", "2026-05-20").filter(
      (r) => r.lessonType === "恆常",
    );

    expect(rows).toHaveLength(2);
  });

  it("does not show extra lessons from other dates on daily timetable", () => {
    const records = [
      mondayRule({ id: "rule-sat", weekday: "六", time: "11:30 AM", room: "M前" }),
    ];
    const state = emptyState();
    state.extraEntries.push({
      id: "ex-sat",
      date: "2026-07-04",
      time: "11:30 AM",
      room: "M前",
    });

    const fridayRows = buildDayTimetableRowsForDate(records, state, "2026-07-03", "2026-07-03");
    expect(fridayRows).toHaveLength(0);

    const saturdayRows = buildDayTimetableRowsForDate(records, state, "2026-07-04", "2026-07-03");
    expect(saturdayRows.some((r) => r.lessonType === "加堂" && r.time === "11:30 AM")).toBe(true);
  });
});
