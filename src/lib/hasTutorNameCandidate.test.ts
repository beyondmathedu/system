import { describe, expect, it } from "vitest";
import { hasTutorNameCandidate } from "@/lib/tutorMonthCandidate";
import type { RoomSlotTutorRule } from "@/lib/roomSlotTutorRules";
import type { YearLessonRecord, YearLessonState } from "@/lib/yearScheduleCore";

function emptyState(): YearLessonState {
  return {
    attendance: {},
    hiddenDates: {},
    overrides: {},
    rescheduleEntries: [],
    extraEntries: [],
  };
}

function hopeSaturdayRule(overrides: Partial<YearLessonRecord> = {}): YearLessonRecord {
  return {
    id: "rule-hope-sat",
    effectiveDate: "2026-05-01",
    weekday: "六",
    time: "10:00 AM",
    room: "Hope",
    createdAt: 1,
    ...overrides,
  };
}

function leoSlot(overrides: Partial<RoomSlotTutorRule> = {}): RoomSlotTutorRule {
  return {
    id: "slot-leo",
    room: "Hope",
    weekday: "六",
    time: "10:00 AM",
    tutor_name: "Leo",
    effective_date: "2026-05-01",
    ...overrides,
  };
}

describe("hasTutorNameCandidate", () => {
  it("matches explicit schedule tutor", () => {
    const records = [hopeSaturdayRule({ tutor: "Leo" })];
    expect(hasTutorNameCandidate(records, emptyState(), new Set(["Leo"]))).toBe(true);
  });

  it("matches room-slot tutor when schedule tutor is empty (Leo / Pammi case)", () => {
    const records = [hopeSaturdayRule({ tutor: undefined })];
    expect(
      hasTutorNameCandidate(records, emptyState(), new Set(["Leo", "張皓程"]), [leoSlot()]),
    ).toBe(true);
  });

  it("does not match unrelated room slots", () => {
    const records = [hopeSaturdayRule({ room: "B", time: "04:30 PM", weekday: "一" })];
    expect(hasTutorNameCandidate(records, emptyState(), new Set(["Leo"]), [leoSlot()])).toBe(false);
  });

  it("matches reschedule target that lands on a Leo room slot", () => {
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-08-03",
      toDate: "2026-08-01", // Saturday
      time: "10:00 AM",
      room: "Hope",
    });
    expect(hasTutorNameCandidate([], state, new Set(["Leo"]), [leoSlot()])).toBe(true);
  });
});
