export type DayTimetableUiLocale = "zh" | "en";

function fillFeeHeavy(
  template: string,
  lookback: number,
  threshold: number,
): string {
  return template.replace(/\{lookback\}/g, String(lookback)).replace(/\{threshold\}/g, String(threshold));
}

export function formatFeeHeavyLine(
  locale: DayTimetableUiLocale,
  lookback: number,
  threshold: number,
): string {
  const t = dayTimetableTableStrings[locale];
  return fillFeeHeavy(t.feeHeavyTail, lookback, threshold);
}

export const dayTimetableTableStrings = {
  zh: {
    examBlurbTitle: "考試日期",
    examDateBlurb:
      "欄：與各學生在「學生獨立課堂」頁（Students → 該生 → Lessons）所填寫的考試日期相同，由系統同步讀取。",
    coloursLegendTitle: "底色與色帶",
    coloursIntroBeforeSwatches: "：恆常格＝該堂導師於 Tutor 頁顏色；",
    coloursBetweenSwatches: "補堂／調堂、",
    coloursAfterExtraSwatch: "加堂。",
    feeIntro: "學費狀況（來自學費紀錄表 submitted_amount）：左邊",
    feeBetweenStripes: "該曆月未繳；左邊",
    feeHeavyTail:
      "近 {lookback} 個月內至少 {threshold} 個月未繳。顏色與門檻請在同頁「課表顏色與學費標示」區塊調整。",
    capacityLabel: "餘額列",
    capacityBlurbBeforeLink: "：各房各時段下方綠底列為「恆常人數／上限／餘額」；上限可在 ",
    capacityBlurbAfterLink: " 編輯（未設定則用預設：B、M前 5；M後、Hope 6；Hope 2 為 5）。",
    time: "時間",
    name: "姓名",
    grade: "年級",
    examHeader: "考試日期",
    examThTitle: "與該學生在學生獨立課堂頁設定的考試日期相同",
    remarkPlaceholder: "輸入備註（自動儲存）",
    saving: "儲存中...",
    autoSaved: "已自動儲存",
    balanceRow: "餘額",
    regularCount: "恆常",
    cap: "上限",
    remaining: "餘",
    swatchTitleResched: "補堂",
    swatchTitleExtra: "加堂",
  },
  en: {
    examBlurbTitle: "Exam date",
    examDateBlurb:
      " column: same as each student’s exam date on Students → that student → Lessons; synced by the system.",
    coloursLegendTitle: "Colours & stripes",
    coloursIntroBeforeSwatches: ": Regular cells use the tutor colour from the Tutor page; ",
    coloursBetweenSwatches: "reschedule / ",
    coloursAfterExtraSwatch: " extra lesson. ",
    feeIntro: "Fee (from submitted_amount): ",
    feeBetweenStripes: " = unpaid this calendar month; left stripe ",
    feeHeavyTail:
      " = at least {threshold} unpaid month(s) in the last {lookback} months. Edit colours and thresholds in the “Timetable colours & fee highlights” block on this page.",
    capacityLabel: "Capacity row",
    capacityBlurbBeforeLink:
      ": green row under each slot shows regular / max / remaining; set max on ",
    capacityBlurbAfterLink: " (defaults: B & M front 5; M back & Hope 6; Hope 2: 5).",
    time: "Time",
    name: "Name",
    grade: "Grade",
    examHeader: "Exam date",
    examThTitle: "Same as on the student’s Lessons page",
    remarkPlaceholder: "Notes (auto-saved)",
    saving: "Saving…",
    autoSaved: "Saved",
    balanceRow: "Cap.",
    regularCount: "Regular",
    cap: "Max",
    remaining: "Left",
    swatchTitleResched: "Reschedule",
    swatchTitleExtra: "Extra lesson",
  },
} as const;

export const dayTimetableStyleEditorStrings = {
  zh: {
    title: "課表顏色與學費標示（全站）",
    reset: "還原預設色",
    intro: "在此修改即生效（約數十秒內快取更新）。補堂／加堂用底色 hex；學費用左邊色帶 hex。",
    rescheduleBg: "補堂／調堂底色",
    extraBg: "加堂底色",
    feeUnpaid: "當月未繳 — 左色帶",
    feeArrears: "多月未繳 — 左色帶",
    lookback: "學費回溯月數（含當月）",
    lookbackHint: "2–24",
    threshold: "多月未繳門檻",
    thresholdHint: "窗口內未繳月數 ≥ 此值",
    save: "儲存",
    saving: "儲存中…",
    saved: "已儲存。",
    sqlError: "請在 Supabase 執行 supabase/migrations/20260512_app_day_timetable_settings.sql",
    ariaReschedBg: "補堂底色",
    ariaExtraBg: "加堂底色",
    ariaFeeUnpaid: "當月未繳色帶",
    ariaFeeArrears: "多月未繳色帶",
  },
  en: {
    title: "Timetable colours & fee highlights (site-wide)",
    reset: "Reset defaults",
    intro:
      "Changes apply within about a minute (cache). Reschedule/extra use background hex; fee uses left stripe hex.",
    rescheduleBg: "Reschedule lesson background",
    extraBg: "Extra lesson background",
    feeUnpaid: "Unpaid this month — left stripe",
    feeArrears: "Multiple unpaid months — left stripe",
    lookback: "Fee lookback months (incl. current)",
    lookbackHint: "2–24",
    threshold: "Heavy unpaid threshold",
    thresholdHint: "Unpaid months in window ≥ this",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    sqlError: "Run supabase/migrations/20260512_app_day_timetable_settings.sql in Supabase.",
    ariaReschedBg: "Reschedule background",
    ariaExtraBg: "Extra lesson background",
    ariaFeeUnpaid: "Unpaid this month stripe",
    ariaFeeArrears: "Multiple unpaid months stripe",
  },
} as const;
