import { describe, expect, it } from "vitest";
import {
  hasRoomScheduleCandidate,
  hasRoomScheduleCandidateFromRecords,
  hasRoomScheduleCandidateFromStateSignals,
} from "@/lib/roomScheduleCandidate";
import type { YearLessonRecord } from "@/lib/yearScheduleCore";

describe("roomScheduleCandidate", () => {
  const rule: YearLessonRecord = {
    weekday: "一",
    time: "4:00 PM",
    room: "Hope",
    createdAt: 1,
  };

  it("matches room from records", () => {
    expect(hasRoomScheduleCandidateFromRecords([rule], "Hope")).toBe(true);
    expect(hasRoomScheduleCandidateFromRecords([rule], "Hope 1")).toBe(true);
    expect(hasRoomScheduleCandidateFromRecords([rule], "B")).toBe(false);
  });

  it("matches room from reschedule state without records hit", () => {
    expect(
      hasRoomScheduleCandidateFromStateSignals(
        {
          overrides: {},
          extraEntries: [],
          rescheduleEntries: [
            { id: "rs", fromDate: "2026-05-01", toDate: "2026-05-08", time: "4:00 PM", room: "M前" },
          ],
        },
        "M前",
      ),
    ).toBe(true);
  });

  it("combines records and state signals", () => {
    expect(
      hasRoomScheduleCandidate(
        [{ ...rule, room: "B" }],
        {
          attendance: {},
          hiddenDates: {},
          overrides: { "2026-05-01": { room: "Hope" } },
          rescheduleEntries: [],
          extraEntries: [],
        },
        "Hope",
      ),
    ).toBe(true);
  });

  it("matches cross-month reschedule toDate room", () => {
    expect(
      hasRoomScheduleCandidateFromStateSignals(
        {
          overrides: {},
          extraEntries: [],
          rescheduleEntries: [
            {
              id: "rs",
              fromDate: "2026-05-25",
              toDate: "2026-06-03",
              time: "4:00 PM",
              room: "Hope",
            },
          ],
        },
        "Hope",
      ),
    ).toBe(true);
    expect(
      hasRoomScheduleCandidateFromStateSignals(
        {
          overrides: {},
          extraEntries: [],
          rescheduleEntries: [
            {
              id: "rs",
              fromDate: "2026-05-25",
              toDate: "2026-06-03",
              time: "4:00 PM",
              room: "Hope",
            },
          ],
        },
        "M前",
      ),
    ).toBe(false);
  });

  it("matches extra entry room for candidate scan", () => {
    expect(
      hasRoomScheduleCandidateFromStateSignals(
        {
          overrides: {},
          extraEntries: [{ id: "ex", date: "2026-05-10", time: "5:00 PM", room: "Hope 1" }],
          rescheduleEntries: [],
        },
        "Hope",
      ),
    ).toBe(true);
  });
});
