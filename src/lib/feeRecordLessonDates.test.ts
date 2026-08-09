import { describe, expect, it } from "vitest";
import { hiddenScheduleRuleDateStorageKey, hiddenScheduleRuleStorageKey } from "@/lib/lessonScheduleHidden";
import {
  collectAttendedBillableLessonDatesForMonth,
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
  it("includes cancelled from-date and excludes cross-month reschedule to-date", () => {
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

    expect(may.includes("25/5")).toBe(true);
    expect(june.includes("3/6")).toBe(false);
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

    expect(may.includes("25/5")).toBe(true);
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

    expect(may.includes("25/5")).toBe(false);
  });

  it("hides a pending-makeup date from fee count via rule+date hidden key", () => {
    const ruleId = "may26-tutor-00002-_|04_30_PM|M_-0501";
    const records = normalizeFeeLessonRecords([
      {
        id: ruleId,
        effectiveDate: "2026-05-01",
        weekday: "二",
        time: "04:30 PM",
        room: "M前",
        createdAt: 1,
      },
    ]);
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-pending-5th",
      fromDate: "2026-06-30",
      toDate: "",
      time: "",
      room: "",
      pending: true,
    });

    const before = collectBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 6,
    });
    expect(before.includes("30/6")).toBe(true);

    state.hiddenDates[hiddenScheduleRuleDateStorageKey(ruleId, "2026-06-30")] = true;

    const after = collectBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 6,
    });
    expect(after.includes("30/6")).toBe(false);
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
    }).filter((d) => d === "25/5").length;

    expect(may25Count).toBe(2);
  });

  it("includes extra lessons when schedule records are empty", () => {
    const state = emptyState();
    state.extraEntries.push(
      { id: "ex-1", date: "2026-05-10", time: "4:00 PM", room: "B" },
      { id: "ex-2", date: "2026-05-10", time: "5:30 PM", room: "M前" },
    );

    const dates = collectBillableLessonDatesForMonth({
      records: [],
      state,
      year: 2026,
      month1to12: 5,
      legacyWeekdays: [],
    });

    expect(dates.filter((d) => d === "10/5").length).toBe(2);
  });

  it("bills moved Extra on origin month only", () => {
    const state = emptyState();
    state.extraEntries.push({
      id: "ex-moved",
      originDate: "2026-07-31",
      date: "2026-08-29",
      time: "02:30 PM",
      room: "M前",
      originTime: "03:00 PM",
      originRoom: "B",
    });

    const july = collectBillableLessonDatesForMonth({
      records: [],
      state,
      year: 2026,
      month1to12: 7,
      legacyWeekdays: [],
    });
    const august = collectBillableLessonDatesForMonth({
      records: [],
      state,
      year: 2026,
      month1to12: 8,
      legacyWeekdays: [],
    });

    expect(july).toEqual(["31/7"]);
    expect(august).toEqual([]);
  });

  it("includes reschedule from-date (not to-date) when schedule records are empty", () => {
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-only",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });

    const may = collectBillableLessonDatesForMonth({
      records: [],
      state,
      year: 2026,
      month1to12: 5,
      legacyWeekdays: [],
    });
    const june = collectBillableLessonDatesForMonth({
      records: [],
      state,
      year: 2026,
      month1to12: 6,
      legacyWeekdays: [],
    });

    expect(may).toEqual(["25/5"]);
    expect(june).toEqual([]);
  });

  it("falls back to weekday estimate when schedule records are empty", () => {
    const state = emptyState();

    const dates = collectBillableLessonDatesForMonth({
      records: [],
      state,
      year: 2026,
      month1to12: 5,
      legacyWeekdays: ["一"],
    });

    expect(dates.some((d) => d.endsWith("/5"))).toBe(true);
  });

  it("collectAttendedBillableLessonDatesForMonth returns only ticked slots", () => {
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
    });
    const attended = collectAttendedBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 5,
    });

    expect(billable.length).toBeGreaterThan(1);
    expect(attended).toEqual(["25/5"]);

    state.attendance = { "regular:rule-mon": true };
    expect(collectAttendedBillableLessonDatesForMonth({
      records,
      state,
      year: 2026,
      month1to12: 5,
    })).toEqual(billable);
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

  it("counts reschedule attendance in from-date month only", () => {
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
    ).toBe(1);
    expect(
      countAttendedBillableLessonsInMonth({
        records,
        state,
        year: 2026,
        month1to12: 6,
      }),
    ).toBe(0);
  });

  it("shows reschedule from→to in the cancelled original month", () => {
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
      collectAttendedBillableLessonDatesForMonth({
        records,
        state,
        year: 2026,
        month1to12: 5,
      }),
    ).toEqual(["25/5→3/6"]);
    expect(
      collectAttendedBillableLessonDatesForMonth({
        records,
        state,
        year: 2026,
        month1to12: 6,
      }),
    ).toEqual([]);
  });

  it("shows regular, extra, and cross-month reschedule in the same month sheet", () => {
    const records = normalizeFeeLessonRecords([
      {
        id: "rule-sun",
        effectiveDate: "2026-06-01",
        weekday: "一",
        time: "10:00 AM",
        room: "B",
        createdAt: 1,
      },
    ]);
    const state = emptyState();
    state.rescheduleEntries.push(
      {
        id: "rs-same",
        fromDate: "2026-06-10",
        toDate: "2026-06-11",
        time: "10:00 AM",
        room: "B",
      },
      {
        id: "rs-cross",
        fromDate: "2026-06-12",
        toDate: "2026-07-02",
        time: "10:00 AM",
        room: "B",
      },
    );
    state.extraEntries.push({
      id: "ex-1",
      date: "2026-06-30",
      time: "4:00 PM",
      room: "B",
    });
    state.attendance["2026-06-01"] = true;
    state.attendance["reschedule:rs-same"] = true;
    state.attendance["reschedule:rs-cross"] = true;
    state.attendance["extra:ex-1"] = true;

    expect(
      collectAttendedBillableLessonDatesForMonth({
        records,
        state,
        year: 2026,
        month1to12: 6,
      }),
    ).toEqual(["1/6", "10/6→11/6", "12/6→2/7", "30/6"]);
  });

  it("legacy attendance skips inactive dates during pause", () => {
    const state = emptyState();
    state.attendance["2026-07-12"] = true;
    state.attendance["2026-09-06"] = true;
    const isDateInactive = (iso: string) => iso >= "2026-07-01" && iso < "2026-09-01";

    expect(
      countAttendedBillableLessonsInMonth({
        records: [],
        state,
        year: 2026,
        month1to12: 7,
        isDateInactive,
      }),
    ).toBe(0);
    expect(
      countAttendedBillableLessonsInMonth({
        records: [],
        state,
        year: 2026,
        month1to12: 9,
        isDateInactive,
      }),
    ).toBe(1);
  });
});
