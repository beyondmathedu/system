import { describe, expect, it } from "vitest";
import {
  canonicalScheduleRoomLabel,
  filterDayTimetablePayloadByLessonView,
  normalizeScheduleRoom,
  resolveScheduleRoomPickerValue,
  scheduleRoomsMatch,
  type DayTimetablePayload,
} from "@/lib/dayTimetableShared";
import { DEFAULT_DAY_TIMETABLE_STYLE } from "@/lib/dayTimetableStyleSettings";

function samplePayload(): DayTimetablePayload {
  return {
    year: 2026,
    month: 7,
    day: 15,
    dateIso: "2026-07-15",
    titleDate: "15 Jul 2026",
    examById: {},
    timetableRemarksById: {},
    byTimeRoom: {
      "4:00 PM::B": [
        { studentId: "00001", name: "A", grade: "F.1", scheduleRemarks: "", lessonType: "恆常", tutorDisplay: "T1" },
        { studentId: "00002", name: "B", grade: "F.2", scheduleRemarks: "", lessonType: "加堂", tutorDisplay: "T2" },
      ],
      "5:30 PM::M前": [
        { studentId: "00003", name: "C", grade: "F.3", scheduleRemarks: "", lessonType: "補堂", tutorDisplay: "T3" },
      ],
    },
    rowFrames: [
      { time: "4:00 PM", maxRows: 2 },
      { time: "5:30 PM", maxRows: 1 },
    ],
    regularPeriodMaxByRoom: { B: 4, "M前": 4, "M後": 4, Hope: 4, "Hope 2": 4 },
    feePaymentToneByStudentId: {},
    timetableStyle: DEFAULT_DAY_TIMETABLE_STYLE,
  };
}

describe("filterDayTimetablePayloadByLessonView", () => {
  it("keeps regular and pending makeup in regular view", () => {
    const filtered = filterDayTimetablePayloadByLessonView(samplePayload(), "regular");
    expect(filtered.byTimeRoom["4:00 PM::B"]?.map((c) => c.lessonType)).toEqual(["恆常"]);
    expect(filtered.rowFrames).toEqual([{ time: "4:00 PM", maxRows: 1 }]);
  });

  it("adds extra onto regular for extra view", () => {
    const extra = filterDayTimetablePayloadByLessonView(samplePayload(), "extra");
    expect(extra.byTimeRoom["4:00 PM::B"]?.map((c) => c.lessonType)).toEqual(["恆常", "加堂"]);
    expect(extra.byTimeRoom["5:30 PM::M前"]).toBeUndefined();
    expect(extra.rowFrames).toEqual([{ time: "4:00 PM", maxRows: 2 }]);
  });

  it("adds reschedule onto regular for reschedule view", () => {
    const reschedule = filterDayTimetablePayloadByLessonView(samplePayload(), "reschedule");
    expect(reschedule.byTimeRoom["4:00 PM::B"]?.map((c) => c.lessonType)).toEqual(["恆常"]);
    expect(reschedule.byTimeRoom["5:30 PM::M前"]?.[0]?.lessonType).toBe("補堂");
    expect(reschedule.rowFrames).toHaveLength(2);
  });

  it("adds inactive keep-slots onto regular for inactive view", () => {
    const base = samplePayload();
    base.byTimeRoom["4:00 PM::B"]!.push({
      studentId: "00099",
      name: "Paused",
      grade: "F.1",
      scheduleRemarks: "",
      lessonType: "恆常",
      tutorDisplay: "T9",
      isInactive: true,
    });
    base.rowFrames = [{ time: "4:00 PM", maxRows: 3 }, { time: "5:30 PM", maxRows: 1 }];
    const inactive = filterDayTimetablePayloadByLessonView(base, "inactive");
    expect(inactive.byTimeRoom["4:00 PM::B"]?.map((c) => c.studentId)).toEqual(["00001", "00099"]);
    expect(inactive.byTimeRoom["5:30 PM::M前"]).toBeUndefined();
  });

  it("includes regular, extra, reschedule, and inactive in all view", () => {
    const base = samplePayload();
    base.byTimeRoom["4:00 PM::B"]!.push({
      studentId: "00099",
      name: "Paused",
      grade: "F.1",
      scheduleRemarks: "",
      lessonType: "恆常",
      tutorDisplay: "T9",
      isInactive: true,
    });
    const all = filterDayTimetablePayloadByLessonView(base, "all");
    expect(all.byTimeRoom["4:00 PM::B"]?.map((c) => c.studentId)).toEqual(["00001", "00002", "00099"]);
    expect(all.byTimeRoom["5:30 PM::M前"]?.[0]?.lessonType).toBe("補堂");
    expect(all.rowFrames).toHaveLength(2);
  });
});

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
