import { describe, expect, it } from "vitest";
import {
  getInactiveMonthGapsInYear,
  isStudentHiddenForFeeSheetMonth,
  makeStudentInactiveDateChecker,
  normalizeReactivateAsFirstActiveDay,
} from "@/lib/studentVisibility";
import { collectBillableLessonDatesForMonth } from "@/lib/feeRecordLessonDates";

describe("isStudentHiddenForFeeSheetMonth", () => {
  const base = {
    grade: "F3",
    manualInactiveEffective: "2026-07-01",
    reactivateDate: "2026-09-01",
  };

  it("hides July and August during pause", () => {
    expect(isStudentHiddenForFeeSheetMonth({ ...base, sheetYear: 2026, sheetMonth: 7 })).toBe(true);
    expect(isStudentHiddenForFeeSheetMonth({ ...base, sheetYear: 2026, sheetMonth: 8 })).toBe(true);
  });

  it("shows again from reactivate month (September) onward", () => {
    expect(isStudentHiddenForFeeSheetMonth({ ...base, sheetYear: 2026, sheetMonth: 9 })).toBe(false);
    expect(isStudentHiddenForFeeSheetMonth({ ...base, sheetYear: 2026, sheetMonth: 10 })).toBe(false);
  });

  it("stays hidden after pause starts when no reactivate date", () => {
    expect(
      isStudentHiddenForFeeSheetMonth({
        ...base,
        reactivateDate: null,
        sheetYear: 2026,
        sheetMonth: 9,
      }),
    ).toBe(true);
  });

  it("treats reactivate on last day of pause month as first day of next month", () => {
    expect(normalizeReactivateAsFirstActiveDay("2026-08-31")).toBe("2026-09-01");
    expect(
      isStudentHiddenForFeeSheetMonth({
        ...base,
        reactivateDate: "2026-08-31",
        sheetYear: 2026,
        sheetMonth: 8,
      }),
    ).toBe(true);
    const checker = makeStudentInactiveDateChecker({
      grade: "F3",
      manualInactiveEffective: "2026-07-01",
      reactivateDate: "2026-08-31",
      year: 2026,
    });
    expect(checker?.("2026-08-31")).toBe(true);
    expect(checker?.("2026-09-01")).toBe(false);
  });
});

describe("makeStudentInactiveDateChecker", () => {
  const checker = makeStudentInactiveDateChecker({
    grade: "F3",
    manualInactiveEffective: "2026-07-01",
    reactivateDate: "2026-09-01",
    year: 2026,
  });

  it("marks July and August dates inactive", () => {
    expect(checker?.("2026-07-15")).toBe(true);
    expect(checker?.("2026-08-20")).toBe(true);
  });

  it("marks September onward active again", () => {
    expect(checker?.("2026-09-01")).toBe(false);
    expect(checker?.("2026-09-15")).toBe(false);
  });
});

describe("collectBillableLessonDatesForMonth inactive pause", () => {
  it("excludes inactive weekdays from legacy weekday estimate", () => {
    const checker = makeStudentInactiveDateChecker({
      grade: "F3",
      manualInactiveEffective: "2026-07-01",
      reactivateDate: "2026-09-01",
      year: 2026,
    });
    const july = collectBillableLessonDatesForMonth({
      records: [],
      state: { attendance: {}, hiddenDates: {}, overrides: {}, rescheduleEntries: [], extraEntries: [] },
      year: 2026,
      month1to12: 7,
      legacyWeekdays: ["六"],
      isDateInactive: checker,
    });
    const sep = collectBillableLessonDatesForMonth({
      records: [],
      state: { attendance: {}, hiddenDates: {}, overrides: {}, rescheduleEntries: [], extraEntries: [] },
      year: 2026,
      month1to12: 9,
      legacyWeekdays: ["六"],
      isDateInactive: checker,
    });
    expect(july).toEqual([]);
    expect(sep.length).toBeGreaterThan(0);
  });

  it("excludes all of August when reactivate is stored as month-end", () => {
    const checker = makeStudentInactiveDateChecker({
      grade: "F3",
      manualInactiveEffective: "2026-07-01",
      reactivateDate: "2026-08-31",
      year: 2026,
    });
    const august = collectBillableLessonDatesForMonth({
      records: [],
      state: { attendance: {}, hiddenDates: {}, overrides: {}, rescheduleEntries: [], extraEntries: [] },
      year: 2026,
      month1to12: 8,
      legacyWeekdays: ["六"],
      isDateInactive: checker,
    });
    expect(august).toEqual([]);
  });
});

describe("getInactiveMonthGapsInYear", () => {
  it("groups July and August when pause runs through summer", () => {
    const gaps = getInactiveMonthGapsInYear({
      grade: "F3",
      manualInactiveEffective: "2026-07-01",
      reactivateDate: "2026-09-01",
      year: 2026,
      firstMonth: 1,
    });
    expect(gaps).toEqual([
      {
        afterMonth: 6,
        months: [7, 8],
        effectiveDate: "2026-07-01",
        reactivateDate: "2026-09-01",
      },
    ]);
  });
});
