import { describe, expect, it } from "vitest";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import {
  buildStudentBaseScheduleRows,
  buildStudentScheduleRows,
  type StudentScheduleMapperState,
} from "@/lib/studentScheduleRowMapper";
import { type YearLessonRecord } from "@/lib/yearScheduleCore";

const YEAR = 2026;

function emptyState(): StudentScheduleMapperState {
  return {
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

describe("studentScheduleRowMapper", () => {
  it("shows cancelled on from-date and reschedule on to-date with English lesson types", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });

    const rows = buildStudentScheduleRows(records, state, YEAR, "2026-06-01");

    const cancelled = rows.find((r) => r.date === "2026-05-25" && r.lessonType === "Cancelled");
    const reschedule = rows.find((r) => r.date === "2026-06-03" && r.lessonType === "Reschedule");

    expect(cancelled).toBeDefined();
    expect(cancelled?.rowKind).toBe("cancelled_original");
    expect(cancelled?.lLabel).toBe("L4");

    expect(reschedule).toBeDefined();
    expect(reschedule?.rescheduleFromDate).toBe("2026-05-25");
    expect(reschedule?.rescheduleEntryId).toBe("rs-1");
    expect(reschedule?.lLabel).toBe("/");
  });

  it("expands all months when no month option is set (Month filter All)", () => {
    const records = [mondayRule()];
    const rows = buildStudentScheduleRows(records, emptyState(), YEAR, "2026-06-01");

    expect(rows.some((r) => r.month === 5)).toBe(true);
    expect(rows.some((r) => r.month === 6)).toBe(true);
  });

  it("builds only the requested month when month option is set", () => {
    const records = [mondayRule()];
    const rows = buildStudentScheduleRows(records, emptyState(), YEAR, "2026-06-01", { month: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.date.startsWith("2026-05"))).toBe(true);
    expect(rows.some((r) => r.date.startsWith("2026-06"))).toBe(false);
  });

  it("maps pending makeup to pending type with reminder label", () => {
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

    const rows = buildStudentScheduleRows(records, state, YEAR, "2026-06-01");
    const pending = rows.find((r) => r.date === "2026-05-25");

    expect(pending?.lessonType).toBe(PENDING_MAKEUP_TYPE_LABEL);
    expect(pending?.lLabel).not.toBe("/");
    expect(pending?.lLabel).toMatch(/^L\d+$/);
    expect(pending?.pendingMakeupLabel).toBe("Makeup until end of June");
    expect(rows.some((r) => r.lessonType === "Reschedule")).toBe(false);
  });

  it("hides pending makeup from admin UI after M+3", () => {
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

    const july = buildStudentScheduleRows(records, state, YEAR, "2026-07-15");
    expect(july.find((r) => r.date === "2026-05-25")?.pendingMakeupLabel).toBe(
      "Reschedule deadline passed",
    );

    const august = buildStudentScheduleRows(records, state, YEAR, "2026-08-01");
    expect(august.some((r) => r.date === "2026-05-25")).toBe(false);
  });

  it("expands only the requested month for base rows (regular lessons for bulk edit)", () => {
    const records = [mondayRule()];
    const may = buildStudentBaseScheduleRows(records, emptyState(), YEAR, "2026-05-20", { month: 5 });
    const june = buildStudentBaseScheduleRows(records, emptyState(), YEAR, "2026-06-01", { month: 6 });

    expect(may.length).toBeGreaterThan(0);
    expect(may.every((r) => r.month === 5 && r.lessonType === "Regular")).toBe(true);
    expect(june.every((r) => r.month === 6)).toBe(true);
    expect(may.some((r) => r.date.startsWith("2026-06"))).toBe(false);
  });

  it("restarts L labels within each expanded month", () => {
    const records = [mondayRule()];
    const may = buildStudentScheduleRows(records, emptyState(), YEAR, "2026-05-20", { month: 5 });
    const june = buildStudentScheduleRows(records, emptyState(), YEAR, "2026-06-01", { month: 6 });

    const mayRegular = may.filter((r) => r.lessonType === "Regular");
    const juneRegular = june.filter((r) => r.lessonType === "Regular");

    expect(mayRegular[0]?.lLabel).toBe("L1");
    expect(juneRegular[0]?.lLabel).toBe("L1");
  });

  it("month expand shows cancelled from-date but not cross-month reschedule target", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });

    const mayView = buildStudentScheduleRows(records, state, YEAR, "2026-05-20", { month: 5 });
    const juneView = buildStudentScheduleRows(records, state, YEAR, "2026-06-01", { month: 6 });

    expect(mayView.some((r) => r.date === "2026-05-25" && r.lessonType === "Cancelled")).toBe(true);
    expect(mayView.some((r) => r.date === "2026-06-03")).toBe(false);

    expect(juneView.some((r) => r.date === "2026-06-03" && r.lessonType === "Reschedule")).toBe(true);
    expect(juneView.some((r) => r.date === "2026-05-25")).toBe(false);
  });

  it("expands only dates inside a custom range", () => {
    const records = [mondayRule()];
    const rows = buildStudentScheduleRows(records, emptyState(), YEAR, "2026-05-20", {
      rangeStartIso: "2026-05-18",
      rangeEndIso: "2026-05-31",
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.date >= "2026-05-18" && r.date <= "2026-05-31")).toBe(true);
    expect(rows.some((r) => r.date === "2026-05-11")).toBe(false);
  });

  it("cross-month reschedule keeps L labels in origin month only", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-jul-aug",
      fromDate: "2026-07-27",
      toDate: "2026-08-04",
      time: "4:00 PM",
      room: "M前",
    });

    const july = buildStudentScheduleRows(records, state, YEAR, "2026-07-15", { month: 7 });
    const august = buildStudentScheduleRows(records, state, YEAR, "2026-08-01", { month: 8 });

    const julyCancelled = july.find((r) => r.date === "2026-07-27");
    const augustReschedule = august.find((r) => r.date === "2026-08-04" && r.lessonType === "Reschedule");
    const augustRegular = august.filter((r) => r.lessonType === "Regular");

    expect(julyCancelled?.lLabel).toMatch(/^L\d+$/);
    expect(augustReschedule?.lLabel).toBe("/");
    expect(augustRegular[0]?.lLabel).toBe("L1");
  });

  it("base schedule rows ignore reschedule state (used for original-slot validation)", () => {
    const records = [mondayRule()];
    const state = emptyState();
    state.rescheduleEntries.push({
      id: "rs-1",
      fromDate: "2026-05-25",
      toDate: "2026-06-03",
      time: "4:00 PM",
      room: "M前",
    });

    const baseMay = buildStudentBaseScheduleRows(records, state, YEAR, "2026-05-20", { month: 5 });

    expect(baseMay.some((r) => r.date === "2026-05-25" && r.lessonType === "Regular")).toBe(true);
    expect(baseMay.some((r) => r.lessonType === "Cancelled")).toBe(false);
    expect(baseMay.some((r) => r.lessonType === "Reschedule")).toBe(false);
  });
});
