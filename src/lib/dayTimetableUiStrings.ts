export const dayTimetableLegendStrings = {
  examRemarksTitle: "Exam & remarks",
  examOnlyTitle: "Exam date",
  examRemarksBody:
    "Exam date synced from Lessons. Hover a name for remarks (not in Grade/Exam).",
  examOnlyBody: "Exam date synced from Lessons.",
  coloursTitle: "Colours & stripes",
  coloursRegular: "Regular = tutor colour; ",
  coloursResched: "reschedule, ",
  coloursExtra: "extra; ",
  coloursCancelled: "cancelled (vacated) = muted strikethrough. ",
  feeUnpaidMonth: "Unpaid month — left stripe: ",
  feeUpToOneMonth: "≤1 mo due; ",
  feeOverOneMonth: ">1 mo due (overrides). Paid or Balance Due ≤ 0: none.",
  coloursEditHint: "Edit colours below.",
  capacityTitle: "Capacity",
  capacityBeforeLink: "Green row = regular / max / left. Limits on ",
  capacityAfterLink: " (B & M front 5; M back & Hope 6; Hope 2: 5).",
  swatchTitleResched: "Reschedule",
  swatchTitleExtra: "Extra lesson",
} as const;

export const dayTimetablePageIntroStrings = {
  daily:
    "Students attending this day (regular, reschedule, extra). Cancelled/vacated slots are hidden — use Regular Class Timetable → Cancelled to see them.",
  regular:
    "Regular lessons only (no reschedule or extra). Green row per slot: regular / max / left — limits on Rooms.",
} as const;

export const dayTimetableTableStrings = {
  time: "Time",
  remarks: "Remarks",
  name: "Name",
  grade: "Grade",
  examHeader: "Exam date",
  examThTitle: "Same as on the student’s Lessons page",
  remarkPlaceholder: "Notes (auto-saved)",
  remarkHoverHint: "hover name to show; hidden from students",
  lessonSummaryLabel: "Lesson summary",
  remarkClickOpen: "Click to view",
  remarkHasNote: "Has note",
  remarkClose: "Close",
  saving: "Saving…",
  autoSaved: "Saved",
  balanceRow: "Cap.",
  regularCount: "Regular",
  cap: "Max",
  remaining: "Left",
  repeatSlotHint:
    "Each time slot repeats room headers: B, M前, M後, Hope, Hope 2 — Name, Grade, Exam date — so columns stay clear when scrolling.",
  roomsHiddenToday: "Rooms with no students in any time slot today are hidden: {rooms}.",
} as const;

export const dayTimetableStyleEditorStrings = {
  title: "Timetable colours & fee highlights (site-wide)",
  reset: "Reset defaults",
  intro:
    "Changes apply within about a minute (cache). Reschedule/extra use background hex; fee uses left stripe hex.",
  rescheduleBg: "Reschedule lesson background",
  extraBg: "Extra lesson background",
  feeUnpaid: "Unpaid this month, up to 1 month due",
  feeArrears: "Unpaid this month, over 1 month due",
  lookback: "Fee lookback months (incl. current)",
  lookbackHint: "2–24",
  threshold: "Heavy unpaid threshold",
  thresholdHint: "Unpaid months ≥ this",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  sqlError: "Run supabase/migrations/20260512_app_day_timetable_settings.sql in Supabase.",
  ariaReschedBg: "Reschedule background",
  ariaExtraBg: "Extra lesson background",
  ariaFeeUnpaid: "Unpaid this month stripe",
  ariaFeeArrears: "Multiple unpaid months stripe",
} as const;
