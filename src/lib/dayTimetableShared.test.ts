import { describe, expect, it } from "vitest";
import {
  canonicalScheduleRoomLabel,
  normalizeScheduleRoom,
  resolveScheduleRoomPickerValue,
  scheduleRoomsMatch,
} from "@/lib/dayTimetableShared";

describe("schedule room labels", () => {
  it("maps Hope 1 variants to Hope", () => {
    for (const raw of ["Hope", "Hope 1", "hope1", "HOPE 1", "Hope Room"]) {
      expect(normalizeScheduleRoom(raw)).toBe("Hope");
      expect(canonicalScheduleRoomLabel(raw)).toBe("Hope");
    }
  });

  it("matches Hope and Hope 1", () => {
    expect(scheduleRoomsMatch("Hope 1", "Hope")).toBe(true);
    expect(scheduleRoomsMatch("Hope", "Hope 2")).toBe(false);
  });

  it("resolves picker value from legacy Hope 1", () => {
    expect(resolveScheduleRoomPickerValue("Hope 1")).toBe("Hope");
    expect(resolveScheduleRoomPickerValue("unknown")).toBe("B");
  });
});
