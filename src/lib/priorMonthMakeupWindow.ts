import { readYmdParts } from "@/lib/intlFormatParts";
import {
  clampDateRangeToLessonSystemStart,
  getLessonSystemStartIso,
} from "@/lib/lessonSystemStart";

function toHkIsoDateFromMs(ms: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));

  const { y, m, d } = readYmdParts(parts);
  return `${y}-${m}-${d}`;
}

/** 補堂／未打勾統計：只計上一個曆月（HK），例：5 月時只計 4 月 1 日～4 月底。 */
export function getPriorMonthMakeupWindow(
  nowMs = Date.now(),
  calendarYear = 2026,
): {
  startIso: string;
  endIso: string;
  labelZh: string;
} {
  const todayIso = toHkIsoDateFromMs(nowMs);
  const y = Number(todayIso.slice(0, 4));
  const m = Number(todayIso.slice(5, 7));
  let prevY = y;
  let prevM = m - 1;
  if (prevM < 1) {
    prevM = 12;
    prevY -= 1;
  }
  const mm = String(prevM).padStart(2, "0");
  const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
  const rawStart = `${prevY}-${mm}-01`;
  const rawEnd = `${prevY}-${mm}-${String(lastDay).padStart(2, "0")}`;
  const clamped = clampDateRangeToLessonSystemStart(rawStart, rawEnd, calendarYear);
  if (!clamped) {
    const emptyAt = getLessonSystemStartIso(calendarYear);
    return {
      startIso: emptyAt,
      endIso: emptyAt,
      labelZh: `${prevY} 年 ${prevM} 月（網站前）`,
    };
  }
  return {
    startIso: clamped.startIso,
    endIso: clamped.endIso,
    labelZh: `${Number(clamped.startIso.slice(0, 4))} 年 ${Number(clamped.startIso.slice(5, 7))} 月`,
  };
}
