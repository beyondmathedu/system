import { describe, expect, it } from "vitest";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
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
    timetablePermanentRemarksById: {},
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
    roomDisplayLabels: {
      B: "B",
      "M前": "M前",
      "M後": "M後",
      Hope: "Hope - Door",
      "Hope 2": "Hope - Shelf",
    },
    feePaymentToneByStudentId: {},
    extraRoomGroups: [],
    roomSlugByGroup: {},
    timetableStyle: DEFAULT_DAY_TIMETABLE_STYLE,
  };
}

describe("filterDayTimetablePayloadByLessonView", () => {
  it("keeps regular in regular view but not pending makeup", () => {
    const filtered = filterDayTimetablePayloadByLessonView(samplePayload(), "regular");
    expect(filtered.byTimeRoom["4:00 PM::B"]?.map((c) => c.lessonType)).toEqual(["恆常"]);
    expect(filtered.rowFrames).toEqual([{ time: "4:00 PM", maxRows: 1 }]);
  });

  it("shows pending makeup only when pendingMakeup flag is on", () => {
    const base = samplePayload();
    base.byTimeRoom["6:00 PM::M前"] = [
      {
        studentId: "00257",
        name: "Pending",
        grade: "F.4",
        scheduleRemarks: "",
        lessonType: PENDING_MAKEUP_TYPE_LABEL,
        tutorDisplay: "Alex",
        pendingMakeupLabel: "Makeup until end of September",
      },
    ];
    base.rowFrames.push({ time: "6:00 PM", maxRows: 1 });

    expect(
      filterDayTimetablePayloadByLessonView(base, "regular").byTimeRoom["6:00 PM::M前"],
    ).toBeUndefined();
    expect(
      filterDayTimetablePayloadByLessonView(base, {
        regular: false,
        extra: false,
        reschedule: false,
        inactive: false,
        cancelled: false,
        pendingMakeup: true,
      }).byTimeRoom["6:00 PM::M前"]?.[0]?.lessonType,
    ).toBe(PENDING_MAKEUP_TYPE_LABEL);
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

  it("includes regular, extra, reschedule, inactive, and cancelled when all flags on", () => {
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
    base.byTimeRoom["2:30 PM::Hope"] = [
      {
        studentId: "00116",
        name: "Vacated",
        grade: "F.1",
        scheduleRemarks: "",
        lessonType: "取消",
        tutorDisplay: "T1",
      },
    ];
    base.rowFrames = [
      { time: "2:30 PM", maxRows: 1 },
      { time: "4:00 PM", maxRows: 3 },
      { time: "5:30 PM", maxRows: 1 },
    ];
    const all = filterDayTimetablePayloadByLessonView(base, "all");
    expect(all.byTimeRoom["4:00 PM::B"]?.map((c) => c.studentId)).toEqual(["00001", "00002", "00099"]);
    expect(all.byTimeRoom["5:30 PM::M前"]?.[0]?.lessonType).toBe("補堂");
    expect(all.byTimeRoom["2:30 PM::Hope"]?.[0]?.lessonType).toBe("取消");
    expect(all.rowFrames).toHaveLength(3);
  });

  it("hides cancelled vacated slots unless cancelled flag is on", () => {
    const base = samplePayload();
    base.byTimeRoom["2:30 PM::Hope"] = [
      {
        studentId: "00116",
        name: "Vacated",
        grade: "F.1",
        scheduleRemarks: "",
        lessonType: "取消",
        tutorDisplay: "T1",
      },
    ];
    base.rowFrames.push({ time: "2:30 PM", maxRows: 1 });
    expect(filterDayTimetablePayloadByLessonView(base, "regular").byTimeRoom["2:30 PM::Hope"]).toBeUndefined();
    expect(filterDayTimetablePayloadByLessonView(base, "reschedule").byTimeRoom["2:30 PM::Hope"]).toBeUndefined();
    expect(
      filterDayTimetablePayloadByLessonView(base, {
        regular: false,
        extra: false,
        reschedule: false,
        inactive: false,
        cancelled: true,
        pendingMakeup: false,
      }).byTimeRoom["2:30 PM::Hope"]?.[0]?.lessonType,
    ).toBe("取消");
  });

  it("allows mixing flags without forcing regular", () => {
    const filtered = filterDayTimetablePayloadByLessonView(samplePayload(), {
      regular: false,
      extra: true,
      reschedule: true,
      inactive: false,
      cancelled: false,
      pendingMakeup: false,
    });
    expect(filtered.byTimeRoom["4:00 PM::B"]?.map((c) => c.lessonType)).toEqual(["加堂"]);
    expect(filtered.byTimeRoom["5:30 PM::M前"]?.[0]?.lessonType).toBe("補堂");
  });
});

describe("schedule room labels", () => {
  it("maps Hope and Hope 1 variants to Hope", () => {
    for (const raw of ["Hope", "Hope 1", "hope1", "HOPE 1", "Hope Room", "Hope - Door"]) {
      expect(normalizeScheduleRoom(raw)).toBe("Hope");
      expect(canonicalScheduleRoomLabel(raw)).toBe("Hope");
    }
  });

  it("maps Hope 2 / Hope - Shelf to Hope 2", () => {
    for (const raw of ["Hope 2", "hope2", "Hope - Shelf", "Hope Shelf"]) {
      expect(normalizeScheduleRoom(raw)).toBe("Hope 2");
      expect(canonicalScheduleRoomLabel(raw)).toBe("Hope 2");
    }
  });

  it("matches Hope and Hope 1", () => {
    expect(scheduleRoomsMatch("Hope 1", "Hope")).toBe(true);
    expect(scheduleRoomsMatch("Hope - Door", "Hope")).toBe(true);
    expect(scheduleRoomsMatch("Hope", "Hope 2")).toBe(false);
    expect(scheduleRoomsMatch("Hope - Shelf", "Hope 2")).toBe(true);
  });

  it("resolves picker value from legacy Hope 1", () => {
    expect(resolveScheduleRoomPickerValue("Hope 1")).toBe("Hope");
    expect(resolveScheduleRoomPickerValue("Hope - Door")).toBe("Hope");
    expect(resolveScheduleRoomPickerValue("Hope - Shelf")).toBe("Hope 2");
    expect(resolveScheduleRoomPickerValue("unknown")).toBe("unknown");
    expect(resolveScheduleRoomPickerValue("")).toBe("B");
  });
});
