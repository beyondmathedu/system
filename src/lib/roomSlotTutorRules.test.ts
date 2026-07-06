import { describe, expect, it } from "vitest";
import {
  resolveRoomSlotTutorForDate,
  timeSuggestionsForScheduleWeekday,
  weekdayCnFromIsoDate,
  type RoomSlotTutorRule,
} from "@/lib/roomSlotTutorRules";

describe("weekdayCnFromIsoDate", () => {
  it("maps ISO dates to Chinese weekday labels", () => {
    expect(weekdayCnFromIsoDate("2026-07-06")).toBe("一");
    expect(weekdayCnFromIsoDate("2026-07-11")).toBe("六");
  });
});

describe("timeSuggestionsForScheduleWeekday", () => {
  it("returns weekday vs Saturday slots", () => {
    expect(timeSuggestionsForScheduleWeekday("一")).toEqual(["03:00 PM", "04:30 PM", "06:00 PM"]);
    expect(timeSuggestionsForScheduleWeekday("五")).toEqual(["03:00 PM", "04:30 PM", "06:00 PM"]);
    expect(timeSuggestionsForScheduleWeekday("六")).toEqual([
      "10:00 AM",
      "11:30 AM",
      "01:00 PM",
      "02:30 PM",
    ]);
    expect(timeSuggestionsForScheduleWeekday("日")).toEqual([]);
  });
});

describe("resolveRoomSlotTutorForDate", () => {
  const rules: RoomSlotTutorRule[] = [
    {
      id: "1",
      room: "Room A",
      weekday: "一",
      time: "04:30 PM",
      tutor_name: "Alice",
      effective_date: "2026-07-01",
    },
    {
      id: "2",
      room: "Room A",
      weekday: "一",
      time: "04:30 PM",
      tutor_name: "Bob",
      effective_date: "2026-08-01",
    },
  ];

  it("picks the latest rule on or before the lesson date", () => {
    expect(
      resolveRoomSlotTutorForDate(rules, {
        room: "Room A",
        weekday: "一",
        time: "04:30 PM",
        dateIso: "2026-07-20",
      }),
    ).toBe("Alice");

    expect(
      resolveRoomSlotTutorForDate(rules, {
        room: "Room A",
        weekday: "一",
        time: "04:30 PM",
        dateIso: "2026-08-15",
      }),
    ).toBe("Bob");
  });

  it("ignores rules with future effective dates", () => {
    expect(
      resolveRoomSlotTutorForDate(rules, {
        room: "Room A",
        weekday: "一",
        time: "04:30 PM",
        dateIso: "2026-06-15",
      }),
    ).toBeUndefined();
  });
});
