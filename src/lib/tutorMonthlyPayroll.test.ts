import { describe, expect, it } from "vitest";
import { inferGradeOnDate } from "@/lib/studentFeePricingGrade";
import {
  classifyGradeBand,
  enrichTutorMonthRowsWithPay,
  materializeTutorMonthPayRows,
  ZERO_ATTENDANCE_GUARANTEE_STUDENT_ID,
  type TutorPayRates,
} from "@/lib/tutorMonthlyPayroll";
import type { TutorMonthLessonRow } from "@/lib/roomScheduleAggregate";

const rates: TutorPayRates = { junior: 100, senior: 200, single: 150 };
const FIRST_SEAT = 80;

function row(
  partial: Partial<TutorMonthLessonRow> & Pick<TutorMonthLessonRow, "rowKey" | "studentId" | "grade">,
): TutorMonthLessonRow {
  return {
    studentName: partial.studentId,
    dateIso: "2026-08-15",
    dateDisplay: "15/8",
    weekdayDisplay: "六",
    time: "4:30 PM",
    room: "A",
    lessonType: "恆常",
    note: "",
    attended: true,
    sortTime: "16:30",
    ...partial,
  };
}

describe("tutor monthly grade band after 1 Sept promotion", () => {
  it("treats inferred pre-Sept F.3 as Junior and post-Sept F.4 as Senior", () => {
    expect(classifyGradeBand(inferGradeOnDate("F4", "2026-08-15"))).toBe("junior");
    expect(classifyGradeBand(inferGradeOnDate("F4", "2026-09-01"))).toBe("senior");
  });

  it("keeps F.1–F.2 junior and F.5–F.6 senior on both sides of 1 Sept", () => {
    expect(classifyGradeBand(inferGradeOnDate("F2", "2026-08-01"))).toBe("junior");
    expect(classifyGradeBand(inferGradeOnDate("F2", "2026-09-01"))).toBe("junior");
    expect(classifyGradeBand(inferGradeOnDate("F5", "2026-08-01"))).toBe("senior");
    expect(classifyGradeBand(inferGradeOnDate("F5", "2026-09-01"))).toBe("senior");
    expect(classifyGradeBand(inferGradeOnDate("F6", "2026-08-01"))).toBe("senior");
    expect(classifyGradeBand(inferGradeOnDate("F6", "2026-09-01"))).toBe("senior");
  });

  it("pays F.3→F.4 student junior in a shared August slot and senior in September", () => {
    const august = enrichTutorMonthRowsWithPay(
      [
        row({
          rowKey: "a",
          studentId: "00001",
          grade: inferGradeOnDate("F4", "2026-08-15"),
          dateIso: "2026-08-15",
        }),
        row({
          rowKey: "b",
          studentId: "00002",
          grade: inferGradeOnDate("F5", "2026-08-15"),
          dateIso: "2026-08-15",
        }),
      ],
      rates,
      FIRST_SEAT,
    );
    const augPromoted = august.rowsWithPay.find((r) => r.studentId === "00001");
    expect(augPromoted?.grade).toBe("F3");
    expect(augPromoted?.subtotal).toBe(FIRST_SEAT);

    const september = enrichTutorMonthRowsWithPay(
      [
        row({
          rowKey: "c",
          studentId: "00001",
          grade: inferGradeOnDate("F4", "2026-09-05"),
          dateIso: "2026-09-05",
        }),
        row({
          rowKey: "d",
          studentId: "00002",
          grade: inferGradeOnDate("F5", "2026-09-05"),
          dateIso: "2026-09-05",
        }),
      ],
      rates,
      FIRST_SEAT,
    );
    const sepPromoted = september.rowsWithPay.find((r) => r.studentId === "00001");
    expect(sepPromoted?.grade).toBe("F4");
    expect(sepPromoted?.subtotal).toBe(FIRST_SEAT);
    const sepHigher = september.rowsWithPay.find((r) => r.studentId === "00002");
    expect(sepHigher?.subtotal).toBe(rates.senior);
  });
});

describe("zero-attendance Single guarantee", () => {
  it("emits one guarantee row for a past date+time+room with 0 ticks", () => {
    const payRows = materializeTutorMonthPayRows(
      [
        row({
          rowKey: "a",
          studentId: "00001",
          grade: "F3",
          attended: false,
          dateIso: "2026-09-03",
          room: "B",
        }),
        row({
          rowKey: "b",
          studentId: "00002",
          grade: "F4",
          attended: false,
          dateIso: "2026-09-03",
          room: "B",
        }),
      ],
      "2026-09-04",
    );
    expect(payRows).toHaveLength(1);
    expect(payRows[0]?.zeroAttendanceGuarantee).toBe(true);
    expect(payRows[0]?.studentId).toBe(ZERO_ATTENDANCE_GUARANTEE_STUDENT_ID);
    expect(payRows[0]?.room).toBe("B");
  });

  it("does not guarantee future slots", () => {
    const payRows = materializeTutorMonthPayRows(
      [
        row({
          rowKey: "a",
          studentId: "00001",
          grade: "F3",
          attended: false,
          dateIso: "2026-09-10",
        }),
      ],
      "2026-09-04",
    );
    expect(payRows).toHaveLength(0);
  });

  it("keeps attended students and skips guarantee when anyone ticked", () => {
    const payRows = materializeTutorMonthPayRows(
      [
        row({
          rowKey: "a",
          studentId: "00001",
          grade: "F3",
          attended: true,
          dateIso: "2026-09-03",
        }),
        row({
          rowKey: "b",
          studentId: "00002",
          grade: "F4",
          attended: false,
          dateIso: "2026-09-03",
        }),
      ],
      "2026-09-04",
    );
    expect(payRows).toHaveLength(1);
    expect(payRows[0]?.studentId).toBe("00001");
    expect(payRows[0]?.zeroAttendanceGuarantee).toBeFalsy();
  });

  it("pays Single for a guarantee row and does not merge two empty rooms", () => {
    const payRows = materializeTutorMonthPayRows(
      [
        row({
          rowKey: "a",
          studentId: "00001",
          grade: "F3",
          attended: false,
          dateIso: "2026-09-03",
          time: "4:30 PM",
          room: "A",
        }),
        row({
          rowKey: "b",
          studentId: "00002",
          grade: "F3",
          attended: false,
          dateIso: "2026-09-03",
          time: "4:30 PM",
          room: "B",
        }),
      ],
      "2026-09-04",
    );
    expect(payRows).toHaveLength(2);
    const { rowsWithPay, monthTotal } = enrichTutorMonthRowsWithPay(payRows, rates, FIRST_SEAT);
    expect(rowsWithPay.every((r) => r.subtotal === rates.single)).toBe(true);
    expect(monthTotal).toBe(rates.single * 2);
  });
});
