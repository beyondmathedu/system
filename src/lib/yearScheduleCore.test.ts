import { describe, expect, it } from "vitest";
import { hiddenScheduleRuleDateStorageKey, hiddenScheduleRuleStorageKey } from "@/lib/lessonScheduleHidden";
import { attendanceAfterRegularToggle, isRegularLessonAttended } from "@/lib/lessonScheduleVersions";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import {
  buildYearScheduleRowsForDateRange,
  buildYearScheduleRowsForMonth,
  filterRowsByRoomAndMonth,
  type YearLessonRecord,
  type YearLessonState,
} from "@/lib/yearScheduleCore";

const YEAR = 2026;

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

describe("yearScheduleCore", () => {
  it("shows cross-month reschedule in target month and cancelled on from-date month", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });

    const may = buildYearScheduleRowsForMonth(records, state, YEAR, 5);
    const june = buildYearScheduleRowsForMonth(records, state, YEAR, 6);

    expect(may.some((r) => r.date === "2026-05-25" && r.lessonType === "取消")).toBe(true);
    expect(may.some((r) => r.date === "2026-06-03")).toBe(false);

    expect(june.some((r) => r.date === "2026-06-03" && r.lessonType === "補堂")).toBe(true);
    expect(june.some((r) => r.date === "2026-05-25")).toBe(false);
  });

  it("shows pending makeup on original date without reschedule row", () => {
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

    const may = buildYearScheduleRowsForMonth(records, state, YEAR, 5);

    expect(may.some((r) => r.date === "2026-05-25" && r.lessonType === PENDING_MAKEUP_TYPE_LABEL)).toBe(
      true,
    );
    expect(may.some((r) => r.lessonType === "補堂")).toBe(false);
  });

  it("respects hidden_dates by rule id", () => {
    const records = [mondayRule({ id: "rule-hide-me" })];
    const state = emptyState();
    state.hiddenDates[hiddenScheduleRuleStorageKey("rule-hide-me")] = true;

    const may = buildYearScheduleRowsForMonth(records, state, YEAR, 5);

    expect(may.some((r) => r.date === "2026-05-25" && r.lessonType === "恆常")).toBe(false);
  });

  it("respects hidden_dates by rule id and calendar date only", () => {
    const records = [mondayRule({ id: "rule-hide-me" })];
    const state = emptyState();
    state.hiddenDates[hiddenScheduleRuleDateStorageKey("rule-hide-me", "2026-05-25")] = true;

    const may = buildYearScheduleRowsForMonth(records, state, YEAR, 5);

    expect(may.some((r) => r.date === "2026-05-25" && r.lessonType === "恆常")).toBe(false);
    expect(may.some((r) => r.date === "2026-05-18" && r.lessonType === "恆常")).toBe(true);
  });

  it("respects hidden_dates by calendar date", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.hiddenDates["2026-05-25"] = true;

    const may = buildYearScheduleRowsForMonth(records, state, YEAR, 5);

    expect(may.some((r) => r.date === "2026-05-25")).toBe(false);
  });

  it("expands English weekday labels (Mon) into regular rows", () => {
    const records = [mondayRule({ weekday: "Mon" })];
    const may = buildYearScheduleRowsForMonth(records, emptyState(), YEAR, 5);

    expect(may.some((r) => r.date === "2026-05-25" && r.lessonType === "恆常")).toBe(true);
  });

  it("emits two regular rows when two rules share a weekday with different slots", () => {
    const records = [
      mondayRule({ id: "rule-a", time: "4:00 PM", room: "M前" }),
      mondayRule({ id: "rule-b", time: "5:30 PM", room: "B" }),
    ];
    const state = emptyState();

    const may25 = buildYearScheduleRowsForMonth(records, state, YEAR, 5).filter(
      (r) => r.date === "2026-05-25" && r.lessonType === "恆常",
    );

    expect(may25).toHaveLength(2);
    expect(may25.map((r) => r.attendanceKey).sort()).toEqual([
      "regular:rule-a:2026-05-25",
      "regular:rule-b:2026-05-25",
    ]);
  });

  it("marks regular attendance per calendar date, not whole rule", () => {
    const records = [mondayRule({ id: "rule-mon" })];
    const june = buildYearScheduleRowsForMonth(records, emptyState(), YEAR, 6);
    const july = buildYearScheduleRowsForMonth(records, emptyState(), YEAR, 7);
    const juneDate = june.find((r) => r.lessonType === "恆常")?.date;
    const julyDate = july.find((r) => r.lessonType === "恆常")?.date;
    expect(juneDate).toBeTruthy();
    expect(julyDate).toBeTruthy();

    const attendance = { [`regular:rule-mon:${juneDate}`]: true };
    expect(isRegularLessonAttended(attendance, { id: "rule-mon" }, juneDate!)).toBe(true);
    expect(isRegularLessonAttended(attendance, { id: "rule-mon" }, julyDate!)).toBe(false);
  });

  it("drops legacy rule-wide attendance when toggling a single date", () => {
    expect(
      attendanceAfterRegularToggle(
        { "regular:rule-mon": true },
        "regular:rule-mon:2026-06-02",
        true,
      ),
    ).toEqual({ "regular:rule-mon:2026-06-02": true });
  });

  it("expands only dates inside a custom range", () => {
    const records = [mondayRule()];
    const state = emptyState();

    const rows = buildYearScheduleRowsForDateRange(records, state, YEAR, "2026-05-18", "2026-05-31");

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.date >= "2026-05-18" && r.date <= "2026-05-31")).toBe(true);
    expect(rows.some((r) => r.date === "2026-05-11")).toBe(false);
  });

  it("includes cross-month reschedule target via second-pass emit when from-date is outside month", () => {
    const records = [mondayRule({ weekday: "二", effectiveDate: "2026-06-01" })];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-orphan",
      fromDate: "2026-05-20",
      toDate: "2026-06-10",
      time: "4:00 PM",
      room: "M前",
    });

    const june = buildYearScheduleRowsForMonth(records, state, YEAR, 6);

    expect(june.some((r) => r.date === "2026-06-10" && r.lessonType === "補堂")).toBe(true);
    expect(june.some((r) => r.date === "2026-05-20")).toBe(false);
  });

  it("cross-month reschedule with room change only matches new room in target month", () => {
    const records = [mondayRule({ room: "M前" })];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-room",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "Hope",
    });

    const june = buildYearScheduleRowsForMonth(records, state, YEAR, 6);
    const hopeJune = filterRowsByRoomAndMonth(june, "Hope", 6);
    const mFrontJune = filterRowsByRoomAndMonth(june, "M前", 6);

    expect(hopeJune.some((r) => r.lessonType === "補堂" && r.date === "2026-06-03")).toBe(true);
    expect(mFrontJune.some((r) => r.lessonType === "補堂")).toBe(false);
  });

  describe("filterRowsByRoomAndMonth", () => {
    it("excludes cancelled rows and filters by month", () => {
      const records = [mondayRule()];
      const state = emptyState();
      state.rescheduleEntries.push({
        id: "rs-1",
        fromDate: "2026-05-25",
        toDate: "2026-06-03",
        time: "4:00 PM",
        room: "M前",
      });

      const may = buildYearScheduleRowsForMonth(records, state, YEAR, 5);
      const filtered = filterRowsByRoomAndMonth(may, "M前", 5);

      expect(may.some((r) => r.lessonType === "取消")).toBe(true);
      expect(filtered.some((r) => r.lessonType === "取消")).toBe(false);
      expect(filtered.every((r) => Number(r.date.slice(5, 7)) === 5)).toBe(true);
    });

    it("matches Hope 1 stored room against Hope filter", () => {
      const records = [mondayRule({ room: "Hope 1" })];
      const may = buildYearScheduleRowsForMonth(records, emptyState(), YEAR, 5);
      const hopeRows = filterRowsByRoomAndMonth(may, "Hope", 5);
      const bRows = filterRowsByRoomAndMonth(may, "B", 5);

      expect(hopeRows.some((r) => r.date === "2026-05-25")).toBe(true);
      expect(bRows.some((r) => r.date === "2026-05-25")).toBe(false);
    });

    it("respects day override room when filtering", () => {
      const records = [mondayRule({ room: "B" })];
      const state = emptyState();
      state.overrides["2026-05-25"] = { room: "Hope" };

      const may = buildYearScheduleRowsForMonth(records, state, YEAR, 5);
      const hopeRows = filterRowsByRoomAndMonth(may, "Hope", 5);
      const bRows = filterRowsByRoomAndMonth(may, "B", 5);

      expect(hopeRows.some((r) => r.date === "2026-05-25")).toBe(true);
      expect(bRows.some((r) => r.date === "2026-05-25")).toBe(false);
    });

    it("includes extra lesson in matching room", () => {
      const records = [mondayRule({ room: "B" })];
      const state = emptyState();
      state.extraEntries.push({
        id: "ex-hope",
        date: "2026-05-10",
        time: "5:00 PM",
        room: "Hope",
      });

      const may = buildYearScheduleRowsForMonth(records, state, YEAR, 5);
      const hopeRows = filterRowsByRoomAndMonth(may, "Hope", 5);

      expect(hopeRows.some((r) => r.lessonType === "加堂" && r.date === "2026-05-10")).toBe(true);
    });
  });
});
