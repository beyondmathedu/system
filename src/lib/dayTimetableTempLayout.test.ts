import { describe, expect, it } from "vitest";
import type { DayTimetableCell } from "@/lib/dayTimetableShared";
import {
  applyTempRoomMoves,
  findOriginalRoomForStudent,
  resolveTempDragStudentIds,
  studentIdsInSameTimeRange,
  tempRoomMoveKey,
} from "@/lib/dayTimetableTempLayout";

function cell(id: string, name: string): DayTimetableCell {
  return {
    studentId: id,
    name,
    grade: "F1",
    scheduleRemarks: "",
    lessonType: "恆常",
    tutorDisplay: "Alex",
  };
}

describe("applyTempRoomMoves", () => {
  it("moves a student to another room at the same time", () => {
    const byTimeRoom = {
      "10:00 AM::Hope": [cell("00160", "A"), cell("00007", "B")],
      "10:00 AM::Hope 2": [] as DayTimetableCell[],
    };
    const moves = { [tempRoomMoveKey("10:00 AM", "00160")]: "Hope 2" as const };
    const { byTimeRoom: next, rowFrames } = applyTempRoomMoves(
      byTimeRoom,
      moves,
      ["Hope", "Hope 2"],
      ["10:00 AM"],
    );
    expect(next["10:00 AM::Hope"].map((c) => c.studentId)).toEqual(["00007"]);
    expect(next["10:00 AM::Hope 2"].map((c) => c.studentId)).toEqual(["00160"]);
    expect(rowFrames[0].maxRows).toBe(1);
  });

  it("moves a student into a layout-added room column", () => {
    const byTimeRoom = {
      "10:00 AM::Hope": [cell("00160", "A")],
    };
    const moves = { [tempRoomMoveKey("10:00 AM", "00160")]: "Band" };
    const { byTimeRoom: next } = applyTempRoomMoves(
      byTimeRoom,
      moves,
      ["Hope", "Band"],
      ["10:00 AM"],
    );
    expect(next["10:00 AM::Hope"]).toEqual([]);
    expect(next["10:00 AM::Band"].map((c) => c.studentId)).toEqual(["00160"]);
  });

  it("finds original room", () => {
    const byTimeRoom = {
      "10:00 AM::B": [cell("00160", "A")],
    };
    expect(findOriginalRoomForStudent(byTimeRoom, "10:00 AM", "00160")).toBe("B");
  });
});

describe("multi-select drag helpers", () => {
  it("moves all selected same-time students when dragging one of them", () => {
    expect(
      resolveTempDragStudentIds("10:00 AM", "00160", [
        tempRoomMoveKey("10:00 AM", "00160"),
        tempRoomMoveKey("10:00 AM", "00007"),
      ]),
    ).toEqual(["00160", "00007"]);
  });

  it("moves only the dragged student when not in a multi-selection", () => {
    expect(
      resolveTempDragStudentIds("10:00 AM", "00160", [tempRoomMoveKey("10:00 AM", "00007")]),
    ).toEqual(["00160"]);
  });

  it("builds an inclusive same-time range", () => {
    expect(studentIdsInSameTimeRange(["a", "b", "c", "d"], "b", "d")).toEqual(["b", "c", "d"]);
  });
});
