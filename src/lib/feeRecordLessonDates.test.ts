import { describe, expect, it } from "vitest";
import { hiddenScheduleRuleStorageKey } from "@/lib/lessonScheduleHidden";
import {
  collectBillableLessonDatesForMonth,
  countAttendedBillableLessonsInMonth,
  normalizeFeeLessonRecords,
} from "@/lib/feeRecordLessonDates";
import { type YearLessonState } from "@/lib/yearScheduleCore";

function emptyState(): YearLessonState {
  return {
    attendance: {},
    hiddenDates: {},
    overrides: {},
    rescheduleEntries: [],
    extraEntries: [],
  };
}

describe("feeRecordLessonDates", () => {
  it("excludes cancelled from-date and includes reschedule to-date", () => {
    const records = normalizeFeeLessonRecords([
      {
        id: "rule-mon",
        effectiveDate: "2026-05-01",
        weekday: "一",
        time: "4:00 PM",
        room: "M前",
        createdAt: 1,
      },
    ]);
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });

    const may = collectBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 5,
    });
    const june = collectBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 6,
    });

    expect(may.includes("5/25")).toBe(false);
    expect(june.includes("6/3")).toBe(true);
  });

  it("includes pending makeup on original date", () => {
    const records = normalizeFeeLessonRecords([
      {
        id: "rule-mon",
        effectiveDate: "2026-05-01",
        weekday: "一",
        time: "4:00 PM",
        room: "M前",
        createdAt: 1,
      },
    ]);
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-pending",
      fromDate: "2026-05-25",
      toDate: "",
      time: "4:00 PM",
      room: "M前",
      pending: true,
    });

    const may = collectBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 5,
    });

    expect(may.includes("5/25")).toBe(true);
  });

  it("respects hidden_dates by rule id", () => {
    const records = normalizeFeeLessonRecords([
      {
        id: "rule-hide-me",
        effectiveDate: "2026-05-01",
        weekday: "一",
        time: "4:00 PM",
        room: "M前",
        createdAt: 1,
      },
    ]);
    const state = emptyState();
    state.hiddenDates[hiddenScheduleRuleStorageKey("rule-hide-me")] = true;

    const may = collectBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 5,
    });

    expect(may.includes("5/25")).toBe(false);
  });

  it("emits two slots on the same weekday when two rules share it", () => {
    const records = normalizeFeeLessonRecords([
      {
        id: "rule-a",
        effectiveDate: "2026-05-01",
        weekday: "一",
        time: "4:00 PM",
        room: "M前",
        createdAt: 1,
      },
      {
        id: "rule-b",
        effectiveDate: "2026-05-01",
        weekday: "一",
        time: "5:30 PM",
        room: "B",
        createdAt: 2,
      },
    ]);
    const state = emptyState();

    const may25Count = collectBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 5,
    }).filter((d) => d === "5/25").length;

    expect(may25Count).toBe(2);
  });

  it("falls back to weekday estimate when schedule records are empty", () => {
    const state = emptyState();
    state.extraEntries.push({ id: "ex-1", date: "2026-05-10", time: "4:00 PM", room: "B" });

    const dates = collectBillableLessonDatesForMonth({
      records: [],
      state,
      year: 2026,
      month1to12: 5,
      legacyWeekdays: ["一"],
    });

    expect(dates.includes("5/10")).toBe(true);
    expect(dates.some((d) => d.startsWith("5/"))).toBe(true);
  });

  it("counts attended regular slots via dateIso or regular:ruleId keys", () => {
    const records = normalizeFeeLessonRecords([
      {
        id: "rule-mon",
        effectiveDate: "2026-05-01",
        weekday: "一",
        time: "4:00 PM",
        room: "M前",
        createdAt: 1,
      },
    ]);
    const state = emptyState();
    state.attendance["2026-05-25"] = true;

    const billable = collectBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 5,
    }).length;
    const attended = countAttendedBillableLessonsInMonth({
      records,
      state,
      year: 2026,
      month1to12: 5,
    });

    expect(billable).toBeGreaterThan(0);
    expect(attended).toBe(1);
    expect(attended).toBeLessThanOrEqual(billable);

    state.attendance = { "regular:rule-mon": true };
    expect(
      countAttendedBillableLessonsInMonth({
        records,
        state,
        year: 2026,
        month1to12: 5,
      }),
    ).toBe(billable);
  });

  it("counts reschedule attendance on to-date only", () => {
    const records = normalizeFeeLessonRecords([
      {
        id: "rule-mon",
        effectiveDate: "2026-05-01",
        weekday: "一",
        time: "4:00 PM",
        room: "M前",
        createdAt: 1,
      },
    ]);
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });
    state.attendance["reschedule:rs-1"] = true;

    expect(
      countAttendedBillableLessonsInMonth({
        records,
        state,
        year: 2026,
        month1to12: 5,
      }),
    ).toBe(0);
    expect(
      countAttendedBillableLessonsInMonth({
        records,
        state,
        year: 2026,
        month1to12: 6,
      }),
    ).toBe(1);
  });
});
