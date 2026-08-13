import { describe, expect, it } from "vitest";
import {
  getCurrentMonthUntickedCount,
  getLessonUntickedMetrics,
  getUpcomingUntickedCount,
  getUpcomingUntickedDates,
  type Lesson2026Record,
  type Lesson2026State,
} from "@/lib/lesson2026Summary";

const YEAR = 2026;

function emptyState(): Lesson2026State {
  return {
    attendance: {},
    hiddenDates: {},
    overrides: {},
    rescheduleEntries: [],
    extraEntries: [],
  };
}

function mondayRule(overrides: Partial<Lesson2026Record> = {}): Lesson2026Record {
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

/** HK noon on the given calendar date. */
function hkMs(iso: string) {
  return new Date(`${iso}T12:00:00+08:00`).getTime();
}

describe("lesson2026Summary", () => {
  it("counts unticked lessons in prior month makeup window", () => {
    const records = [mondayRule()];
    const state = emptyState();
    // 2026-06-01 HK → prior month is May 2026
    state.attendance["2026-05-04"] = true;
    state.attendance["2026-05-11"] = true;
    state.attendance["2026-05-18"] = true;

    const metrics = getLessonUntickedMetrics(records, state, hkMs("2026-06-01"), YEAR);

    expect(metrics.makeupCount).toBe(1);
    expect(metrics.makeupDates).toEqual(["2026-05-25"]);
    expect(getUpcomingUntickedCount(records, state, hkMs("2026-06-01"), YEAR)).toBe(1);
    expect(getUpcomingUntickedDates(records, state, hkMs("2026-06-01"), YEAR)).toEqual([
      "2026-05-25",
    ]);
  });

  it("counts current-month unticked regular lessons", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.attendance["2026-05-25"] = true;

    const metrics = getLessonUntickedMetrics(records, state, hkMs("2026-05-20"), YEAR);

    expect(metrics.currentMonthUntickedCount).toBeGreaterThan(0);
    expect(getCurrentMonthUntickedCount(records, state, hkMs("2026-05-20"), YEAR)).toBe(
      metrics.currentMonthUntickedCount,
    );
    expect(metrics.makeupDates.every((d) => d.startsWith("2026-05"))).toBe(true);
  });

  it("excludes cancelled from-date from current month unticked count", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });

    const withReschedule = getLessonUntickedMetrics(records, state, hkMs("2026-05-20"), YEAR);
    const withoutReschedule = getLessonUntickedMetrics(records, emptyState(), hkMs("2026-05-20"), YEAR);

    expect(withReschedule.currentMonthUntickedCount).toBeLessThan(
      withoutReschedule.currentMonthUntickedCount,
    );
  });

  it("counts pending makeup in prior month makeup window", () => {
    const records = [mondayRule({ weekday: "六", id: "rule-sat", time: "2:30 PM" })];
    const state = emptyState();
    state.rescheduleEntries.push(
      {
        id: "pm-1",
        fromDate: "2026-07-18",
        toDate: "",
        time: "",
        room: "",
        pending: true,
        fromScheduleRuleId: "rule-sat",
        fromTime: "2:30 PM",
        fromRoom: "M前",
      },
      {
        id: "pm-2",
        fromDate: "2026-07-25",
        toDate: "",
        time: "",
        room: "",
        pending: true,
        fromScheduleRuleId: "rule-sat",
        fromTime: "2:30 PM",
        fromRoom: "M前",
      },
    );
    state.attendance["regular:rule-sat:2026-07-04"] = true;
    state.attendance["regular:rule-sat:2026-07-11"] = true;

    const metrics = getLessonUntickedMetrics(records, state, hkMs("2026-08-10"), YEAR);

    expect(metrics.makeupCount).toBe(2);
    expect(metrics.makeupDates).toEqual(["2026-07-18", "2026-07-25"]);
  });

  it("does not count completed reschedule cancelled originals in makeup window", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-07-04",
      toDate: "2026-08-01",
      time: "4:00 PM",
      room: "M前",
    });

    const metrics = getLessonUntickedMetrics(records, state, hkMs("2026-08-10"), YEAR);

    expect(metrics.makeupDates).not.toContain("2026-07-04");
  });

  it("counts reschedule to-date attendance via reschedule:id key", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });
    state.attendance["reschedule:rs-1"] = true;

    const juneMetrics = getLessonUntickedMetrics(records, state, hkMs("2026-06-10"), YEAR);

    expect(juneMetrics.currentMonthUntickedCount).toBeGreaterThan(0);
    expect(
      getUpcomingUntickedDates(records, state, hkMs("2026-06-10"), YEAR).includes("2026-06-03"),
    ).toBe(false);
  });

  it("excludes inactive holiday dates from prior-month makeup count", () => {
    const records = [mondayRule()];
    const state = emptyState();
    const isDateInactive = (iso: string) => iso >= "2026-07-01" && iso < "2026-09-01";

    const withoutInactive = getLessonUntickedMetrics(records, state, hkMs("2026-08-10"), YEAR);
    const withInactive = getLessonUntickedMetrics(records, state, hkMs("2026-08-10"), YEAR, {
      isDateInactive,
    });

    expect(withoutInactive.makeupCount).toBeGreaterThan(0);
    expect(withInactive.makeupCount).toBe(0);
    expect(
      getUpcomingUntickedDates(records, state, hkMs("2026-08-10"), YEAR, { isDateInactive }),
    ).toEqual([]);
  });
});
