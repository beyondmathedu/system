import { describe, expect, it } from "vitest";
import {
  autoF6InactivePeriod,
  getInactiveMonthGapsInYear,
  getInactiveMonthGapsInYearFromPeriods,
  isStudentHiddenForFeeSheetMonth,
  isStudentHiddenForFeeSheetMonthFromPeriods,
  isStudentInactiveOnDate,
  isStudentInactiveOnDateFromPeriods,
  isTemporarilyInactiveOnDateFromPeriods,
  makeStudentInactiveDateChecker,
  makeStudentInactiveDateCheckerFromPeriods,
  normalizeReactivateAsFirstActiveDay,
  shouldHideScheduledLessonForInactivePeriod,
  withAutoF6InactivePeriod,
  type StudentInactivePeriod,
} from "@/lib/studentVisibility";
import { collectBillableLessonDatesForMonth } from "@/lib/feeRecordLessonDates";

describe("period-based inactivity", () => {
  const studentId = "00265";
  const periods: StudentInactivePeriod[] = [
    { studentId, startDate: "2026-07-01", endDate: "2026-09-01" },
    { studentId, startDate: "2026-11-15", endDate: null },
  ];

  it("treats any matching period as inactive", () => {
    expect(isStudentInactiveOnDateFromPeriods({ periods, dateIso: "2026-07-15" })).toBe(true);
    expect(isStudentInactiveOnDateFromPeriods({ periods, dateIso: "2026-08-31" })).toBe(true);
    expect(isStudentInactiveOnDateFromPeriods({ periods, dateIso: "2026-09-01" })).toBe(false);
    expect(isStudentInactiveOnDateFromPeriods({ periods, dateIso: "2026-11-14" })).toBe(false);
    expect(isStudentInactiveOnDateFromPeriods({ periods, dateIso: "2026-11-15" })).toBe(true);
    expect(isStudentInactiveOnDateFromPeriods({ periods, dateIso: "2027-01-01" })).toBe(true);
  });

  it("treats only pauses with Expected return as temporarily inactive", () => {
    expect(isTemporarilyInactiveOnDateFromPeriods({ periods, dateIso: "2026-07-15" })).toBe(true);
    expect(isTemporarilyInactiveOnDateFromPeriods({ periods, dateIso: "2026-09-01" })).toBe(false);
    // Open-ended / graduated — inactive, but not temporary
    expect(isTemporarilyInactiveOnDateFromPeriods({ periods, dateIso: "2026-11-15" })).toBe(false);
    expect(isTemporarilyInactiveOnDateFromPeriods({ periods, dateIso: "2027-01-01" })).toBe(false);
  });

  it("keeps extra and makeup visible during inactive periods on timetables", () => {
    expect(
      shouldHideScheduledLessonForInactivePeriod({
        periods,
        dateIso: "2026-07-15",
        lessonType: "恆常",
      }),
    ).toBe(true);
    expect(
      shouldHideScheduledLessonForInactivePeriod({
        periods,
        dateIso: "2026-07-15",
        lessonType: "加堂",
      }),
    ).toBe(false);
    expect(
      shouldHideScheduledLessonForInactivePeriod({
        periods,
        dateIso: "2026-07-15",
        lessonType: "補堂",
      }),
    ).toBe(false);
  });

  it("creates a date checker from periods", () => {
    const checker = makeStudentInactiveDateCheckerFromPeriods({
      periods,
      studentId,
      grade: "F3",
      year: 2026,
    });
    expect(checker("2026-07-02")).toBe(true);
    expect(checker("2026-10-01")).toBe(false);
    expect(checker("2026-12-01")).toBe(true);
  });

  it("does not apply F6 summer hide to pre-promotion dates for newly promoted F6", () => {
    // Student is F6 today (after 1 Sep), but was F5 during August — Aug lessons must stay editable.
    const checker = makeStudentInactiveDateCheckerFromPeriods({
      periods: [],
      studentId: "00264",
      grade: "F6",
      year: 2026,
    });
    expect(checker("2026-08-15")).toBe(false);
    expect(checker("2026-09-05")).toBe(false);
  });

  it("does not mark Jul/Aug as inactive gaps for newly promoted F6", () => {
    const gaps = getInactiveMonthGapsInYearFromPeriods({
      periods: [],
      studentId: "00264",
      grade: "F6",
      year: 2026,
      firstMonth: 5,
    });
    expect(gaps.some((g) => g.months.includes(7) || g.months.includes(8))).toBe(false);
  });

  it("isStudentInactiveOnDate uses grade-on-date for F6 summer window", () => {
    expect(
      isStudentInactiveOnDate({
        grade: "F6",
        manualInactiveEffective: null,
        year: 2026,
        dateIso: "2026-08-15",
      }),
    ).toBe(false);
  });

  it("hides a fee month only when fully covered by inactivity", () => {
    expect(
      isStudentHiddenForFeeSheetMonthFromPeriods({
        periods,
        studentId,
        grade: "F3",
        sheetYear: 2026,
        sheetMonth: 7,
      }),
    ).toBe(true);
    expect(
      isStudentHiddenForFeeSheetMonthFromPeriods({
        periods,
        studentId,
        grade: "F3",
        sheetYear: 2026,
        sheetMonth: 9,
      }),
    ).toBe(false);
    expect(
      isStudentHiddenForFeeSheetMonthFromPeriods({
        periods,
        studentId,
        grade: "F3",
        sheetYear: 2026,
        sheetMonth: 11,
      }),
    ).toBe(false);
    expect(
      isStudentHiddenForFeeSheetMonthFromPeriods({
        periods,
        studentId,
        grade: "F3",
        sheetYear: 2026,
        sheetMonth: 12,
      }),
    ).toBe(true);
  });
});

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

describe("auto F.6 inactive window (1 Jul–1 Sep)", () => {
  it("builds the Jul–Sep window for an F.6 grade label", () => {
    const period = autoF6InactivePeriod({ studentId: "00100", grade: "F.6", year: 2026 });
    expect(period).toEqual({
      studentId: "00100",
      startDate: "2026-07-01",
      endDate: "2026-09-01",
      note: "auto: F6 graduation",
    });
  });

  it("after Sept promotion, Jul/Aug dates are not auto-inactive (student was still F5 then)", () => {
    // Current grade F6 after 1 Sep → grade-on-date rolls Aug back to F5.
    expect(
      isStudentInactiveOnDate({
        grade: "F6",
        manualInactiveEffective: null,
        year: 2026,
        dateIso: "2026-05-01",
      }),
    ).toBe(false);
    expect(
      isStudentInactiveOnDate({
        grade: "F6",
        manualInactiveEffective: null,
        year: 2026,
        dateIso: "2026-07-01",
      }),
    ).toBe(false);
    expect(
      isStudentInactiveOnDate({
        grade: "F6",
        manualInactiveEffective: null,
        year: 2026,
        dateIso: "2026-08-31",
      }),
    ).toBe(false);
    expect(
      isStudentInactiveOnDate({
        grade: "F6",
        manualInactiveEffective: null,
        year: 2026,
        dateIso: "2026-09-01",
      }),
    ).toBe(false);
  });

  it("still applies the window when grade-on-date is F6 (via withAutoF6InactivePeriod)", () => {
    const periods = withAutoF6InactivePeriod({
      periods: [],
      studentId: "00100",
      grade: "F6",
      year: 2026,
    });
    expect(isStudentInactiveOnDateFromPeriods({ periods, dateIso: "2026-07-01" })).toBe(true);
    expect(isStudentInactiveOnDateFromPeriods({ periods, dateIso: "2026-08-31" })).toBe(true);
    expect(isStudentInactiveOnDateFromPeriods({ periods, dateIso: "2026-09-01" })).toBe(false);
  });

  it("does not hide September fee sheets for newly promoted F.6", () => {
    expect(
      isStudentHiddenForFeeSheetMonth({
        grade: "F6",
        manualInactiveEffective: null,
        reactivateDate: null,
        sheetYear: 2026,
        sheetMonth: 7,
      }),
    ).toBe(true);
    expect(
      isStudentHiddenForFeeSheetMonth({
        grade: "F6",
        manualInactiveEffective: null,
        reactivateDate: null,
        sheetYear: 2026,
        sheetMonth: 9,
      }),
    ).toBe(false);

    const periods = withAutoF6InactivePeriod({
      periods: [],
      studentId: "00100",
      grade: "F.5",
      year: 2026,
    });
    expect(periods).toEqual([]);
  });
});
