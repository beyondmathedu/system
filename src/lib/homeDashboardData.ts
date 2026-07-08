import { unstable_cache } from "next/cache";
import { getPriorMonthMakeupWindow } from "@/lib/priorMonthMakeupWindow";
import {
  formatPendingMakeupFromDateLabel,
  formatPendingMakeupReminderZh,
  isPendingRescheduleEntry,
} from "@/lib/pendingMakeup";
import { SCHEDULE_CACHE_TAG_HOME } from "@/lib/scheduleCacheTags";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  compareStudentReactivateReminders,
  formatStudentReactivateReminderDetail,
  buildStudentInactivePeriodsById,
  isStudentInactiveOnDateFromPeriods,
  withAutoF6InactivePeriod,
} from "@/lib/studentVisibility";
import type { HomeReminderRow } from "@/app/home/HomeReminderPanel";
import { getActiveScheduleRulesForDate } from "@/lib/lessonScheduleVersions";
import {
  loadStudentFeeTierSettingsAdmin,
  resolveFeeTierSettingsForStudent,
  type StudentFeeTierBundle,
} from "@/lib/studentFeeTierSettings";
import { gradeForFeePricing, sumSlotTuitionHkdByLessonCount } from "@/lib/studentFeePricingGrade";

export type HomeWeekBirthdayItem = {
  id: string;
  dayLabel: string;
  dateLabel: string;
  personLabel: string;
};

export type HomeDashboardData = {
  ymdToday: string;
  mdToday: string;
  year: number;
  month: number;
  birthdaySummary: string;
  todayWhatsappHref: string;
  weekBirthdayLines: string[];
  weekBirthdayReminderItems: HomeWeekBirthdayItem[];
  unpaidRows: HomeReminderRow[];
  reschedulePendingRows: HomeReminderRow[];
  pendingLeaveRows: HomeReminderRow[];
  inactiveReturnRows: HomeReminderRow[];
  priorMakeupMonthLabel: string;
  isMonthEndMakeupReminder: boolean;
  daysLeftInMonth: number;
};

function hkTodayParts() {
  const ymdToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const mdToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const year = Number(ymdToday.slice(0, 4)) || new Date().getFullYear();
  const month = Number(ymdToday.slice(5, 7)) || 1;
  return { ymdToday, mdToday, year, month };
}

type YearLessonRecord = {
  effectiveDate?: string;
  weekday: string;
  time: string;
  room: string;
  tutor?: string;
  lessonSummary?: string;
  createdAt: number;
  id?: string;
};

const HK_WEEKDAY_SHORT_TO_CN: Record<string, string> = {
  Mon: "一",
  Tue: "二",
  Wed: "三",
  Thu: "四",
  Fri: "五",
  Sat: "六",
  Sun: "日",
};

const WEEKDAY_ORDER: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };

function toHkIsoDateFromMs(ms: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  let y = "2026";
  let m = "01";
  let d = "01";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    if (p.type === "month") m = p.value;
    if (p.type === "day") d = p.value;
  }
  return `${y}-${m}-${d}`;
}

function normalizeWeekday(raw: unknown) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (["一", "二", "三", "四", "五", "六", "日"].includes(s)) return s;
  if (s.startsWith("星期")) {
    const c = s.slice(2, 3);
    if (["一", "二", "三", "四", "五", "六", "日"].includes(c)) return c;
  }
  const lower = s.toLowerCase();
  if (lower === "mon" || lower === "monday") return "一";
  if (lower === "tue" || lower === "tuesday") return "二";
  if (lower === "wed" || lower === "wednesday") return "三";
  if (lower === "thu" || lower === "thursday") return "四";
  if (lower === "fri" || lower === "friday") return "五";
  if (lower === "sat" || lower === "saturday") return "六";
  if (lower === "sun" || lower === "sunday") return "日";
  return s;
}

function normalizeLessonRecords(raw: unknown): YearLessonRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item as Record<string, unknown>;
      const weekday = normalizeWeekday(o.weekday ?? o.week_day ?? o.weekDay);
      const room = String(o.room ?? o.classroom ?? o.room_name ?? "").trim();
      const time = String(o.time ?? o.lesson_time ?? "").trim();
      const effectiveDate =
        typeof o.effectiveDate === "string"
          ? o.effectiveDate
          : typeof o.effective_date === "string"
            ? o.effective_date
            : undefined;
      const createdAtRaw = o.createdAt ?? o.created_at ?? 0;
      return {
        id: typeof o.id === "string" ? o.id : undefined,
        effectiveDate,
        weekday,
        time,
        room,
        tutor: typeof o.tutor === "string" ? o.tutor : undefined,
        lessonSummary: typeof o.lessonSummary === "string" ? o.lessonSummary : undefined,
        createdAt: Number(createdAtRaw) || 0,
      } as YearLessonRecord;
    })
    .filter((r) => r.weekday && r.room);
}

function buildBaseLessonCountsByWeekdayForMonth(year: number, month1to12: number): Record<string, number> {
  const out: Record<string, number> = { 一: 0, 二: 0, 三: 0, 四: 0, 五: 0, 六: 0, 日: 0 };
  const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    weekday: "short",
  });
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, month1to12 - 1, d, 12));
    const short = weekdayFormatter.format(dt);
    const cn = HK_WEEKDAY_SHORT_TO_CN[short];
    if (cn) out[cn] += 1;
  }
  return out;
}

function getActiveWeekdaysForDate(records: YearLessonRecord[], dateIso: string): string[] {
  const normalized = records.map((r) => ({
    ...r,
    effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
    weekday: normalizeWeekday(r.weekday),
  }));
  const sorted = normalized.sort((a, b) => {
    const ed = String(a.effectiveDate).localeCompare(String(b.effectiveDate));
    if (ed !== 0) return ed;
    return a.createdAt - b.createdAt;
  });
  const active = getActiveScheduleRulesForDate(sorted, dateIso);
  const set = new Set<string>();
  for (const r of active) {
    const wd = normalizeWeekday(r.weekday);
    if (wd) set.add(wd);
  }
  return [...set].sort((a, b) => (WEEKDAY_ORDER[a] ?? 99) - (WEEKDAY_ORDER[b] ?? 99));
}

function formatHkMoneyAmount(n: number): string {
  const x = Math.round((Number(n) || 0) * 100) / 100;
  return x.toLocaleString("en-HK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function fetchHomeDashboardUncached(): Promise<HomeDashboardData> {
  const { ymdToday, mdToday, year, month } = hkTodayParts();
  const supabase = getSupabaseAdmin();

  const [
    { data: studentRows },
    { data: tutorRows },
    { data: periodRows },
    { data: feeRowsAll },
  ] = await Promise.all([
    supabase.from("students").select("id, name_zh, name_en, nickname_en, birth_date, grade"),
    supabase.from("tutors").select("id, name_zh, name_en, birth_date, status"),
    supabase.from("student_visibility_periods").select("student_id, start_date, end_date, note"),
    supabase
      .from("student_monthly_fee_records")
      .select("student_id, submitted_amount, lesson_unit_price, fee_pricing_grade")
      .eq("year", year)
      .eq("month", month),
  ]);

  const inactivePeriodsById = buildStudentInactivePeriodsById(periodRows ?? []);
  const inactiveReturnCandidates: Array<{ studentId: string; reactivateDate: string }> = [];
  for (const [sid, periods] of Object.entries(inactivePeriodsById)) {
    const mostRecentWithReturn = [...(periods ?? [])]
      .filter((p) => p.startDate <= ymdToday && Boolean(p.endDate))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    if (mostRecentWithReturn?.endDate) {
      inactiveReturnCandidates.push({ studentId: sid, reactivateDate: mostRecentWithReturn.endDate });
    }
  }

  const studentDisplayNameById = new Map<string, string>();
  for (const r of studentRows ?? []) {
    const sid = String(r.id ?? "");
    if (!sid) continue;
    studentDisplayNameById.set(
      sid,
      formatStudentDisplayNameOrEmpty(
        {
          id: sid,
          name_zh: (r as { name_zh?: string }).name_zh,
          name_en: (r as { name_en?: string }).name_en,
          nickname_en: (r as { nickname_en?: string }).nickname_en,
        },
        "full",
        sid,
      ),
    );
  }

  inactiveReturnCandidates.sort((a, b) =>
    compareStudentReactivateReminders(a.reactivateDate, b.reactivateDate, ymdToday),
  );
  const inactiveReturnRows: HomeReminderRow[] = inactiveReturnCandidates.map(({ studentId, reactivateDate }) => ({
    studentId,
    displayName: studentDisplayNameById.get(studentId) || studentId,
    detail: formatStudentReactivateReminderDetail(reactivateDate, ymdToday),
    href: `/students/${encodeURIComponent(studentId)}/lessons`,
  }));

  const activeStudentRows = (studentRows ?? []).filter((r) => {
    const sid = String(r.id ?? "");
    const grade = String((r as { grade?: string }).grade ?? "");
    const periods = withAutoF6InactivePeriod({
      periods: inactivePeriodsById[sid] ?? [],
      studentId: sid,
      grade,
      year,
    });
    return !isStudentInactiveOnDateFromPeriods({ periods, dateIso: ymdToday });
  });

  const activeStudentMeta = activeStudentRows.map((r) => {
    const sid = String(r.id ?? "");
    return {
      id: sid,
      birthMd: String((r as { birth_date?: string }).birth_date ?? "").slice(5, 10),
      displayName: formatStudentDisplayNameOrEmpty(
        {
          id: sid,
          name_zh: (r as { name_zh?: string }).name_zh,
          name_en: (r as { name_en?: string }).name_en,
          nickname_en: (r as { nickname_en?: string }).nickname_en,
        },
        "full",
        sid,
      ),
    };
  });
  const activeStudentMetaById = new Map(activeStudentMeta.map((s) => [s.id, s]));

  const activeStudentIdSet = new Set(activeStudentMeta.map((s) => s.id));
  const activeStudentIds = activeStudentMeta.map((s) => s.id);

  const paidAmountByStudentId = new Map<string, number>();
  const pricingByStudentId = new Map<string, { lessonUnitPrice: number; feePricingGrade: string }>();
  for (const row of feeRowsAll ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!activeStudentIdSet.has(sid)) continue;
    paidAmountByStudentId.set(
      sid,
      Number((row as { submitted_amount?: number }).submitted_amount ?? 0) || 0,
    );
    pricingByStudentId.set(sid, {
      lessonUnitPrice: Number((row as { lesson_unit_price?: number | null }).lesson_unit_price ?? 0) || 0,
      feePricingGrade: String((row as { fee_pricing_grade?: string | null }).fee_pricing_grade ?? ""),
    });
  }

  const [feeTierBundle, { data: recRows }, { data: yearStateRowsRaw }] = await Promise.all([
    loadStudentFeeTierSettingsAdmin(supabase),
    activeStudentIds.length
      ? supabase.from("student_lesson_records").select("student_id, records").in("student_id", activeStudentIds)
      : Promise.resolve({ data: [] as unknown[] }),
    activeStudentIds.length
      ? supabase
          .from("student_lessons_year_state")
          .select("student_id, attendance, reschedule_entries, extra_entries")
          .eq("year", year)
          .in("student_id", activeStudentIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  type YearStateRow = {
    student_id?: string;
    attendance?: Record<string, boolean>;
    reschedule_entries?: unknown;
    extra_entries?: unknown;
  };
  const yearStateRows: YearStateRow[] = Array.isArray(yearStateRowsRaw)
    ? (yearStateRowsRaw as YearStateRow[])
    : [];

  const recordsById = new Map<string, YearLessonRecord[]>();
  for (const row of recRows ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    recordsById.set(sid, normalizeLessonRecords((row as { records?: unknown }).records));
  }

  const extraCountByStudentId = new Map<string, number>();
  for (const row of yearStateRows) {
    const sid = String(row.student_id ?? "");
    if (!sid) continue;
    const extras = Array.isArray(row.extra_entries)
      ? (row.extra_entries as Array<{ date?: string }>)
      : [];
    let c = 0;
    for (const ex of extras) {
      const iso = String(ex?.date ?? "").trim();
      if (!iso) continue;
      if (iso.startsWith(`${year}-${String(month).padStart(2, "0")}`)) c += 1;
    }
    extraCountByStudentId.set(sid, c);
  }

  const baseCounts = buildBaseLessonCountsByWeekdayForMonth(year, month);

  const unpaidRows: HomeReminderRow[] = activeStudentMeta
    .map((student) => {
      const paid = paidAmountByStudentId.get(student.id) ?? 0;
      const records = recordsById.get(student.id) ?? [];
      const weekdays = getActiveWeekdaysForDate(records, ymdToday);
      const extraCount = extraCountByStudentId.get(student.id) ?? 0;
      const lessonCount = weekdays.reduce((sum, wd) => sum + (baseCounts[wd] ?? 0), 0) + extraCount;
      const pricing = pricingByStudentId.get(student.id) ?? { lessonUnitPrice: 0, feePricingGrade: "" };
      const gradeFor = gradeForFeePricing("", year, month, pricing.feePricingGrade);
      const tier = resolveFeeTierSettingsForStudent(feeTierBundle, student.id, year, month);
      const expected = sumSlotTuitionHkdByLessonCount({
        lessonCount,
        gradeFor,
        feeTierSettings: tier,
      });
      const due = Math.max(0, expected - paid);
      return { student, paid, expected, due };
    })
    .filter(({ due }) => due > 0.005)
    .map((student) => ({
      studentId: student.student.id,
      displayName: student.student.displayName,
      detail: `${month} 月：應繳 $${formatHkMoneyAmount(student.expected)}，已繳 $${formatHkMoneyAmount(
        student.paid,
      )}，尚欠 $${formatHkMoneyAmount(student.due)}`,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-Hant"));

  const reschedulePendingByStudent = new Map<string, { displayName: string; details: string[] }>();
  for (const row of yearStateRows) {
    const sid = String(row.student_id ?? "");
    if (!sid) continue;
    const meta = activeStudentMetaById.get(sid);
    if (!meta) continue;
    const attendance = (row.attendance ?? {}) as Record<string, boolean>;
    const entries = Array.isArray(row.reschedule_entries)
      ? (row.reschedule_entries as unknown[])
      : [];
    for (const e of entries) {
      if (isPendingRescheduleEntry(e as { toDate?: string; pending?: boolean })) continue;
      const id = String((e as { id?: string })?.id ?? "");
      const toDate = String((e as { toDate?: string })?.toDate ?? "");
      if (!id || !toDate || toDate > ymdToday) continue;
      if (attendance[`reschedule:${id}`] === true) continue;
      const fromDate = String((e as { fromDate?: string })?.fromDate ?? "");
      const line = fromDate
        ? `補堂 ${formatPendingMakeupFromDateLabel(toDate)}（原課 ${formatPendingMakeupFromDateLabel(fromDate)}）尚未打勾`
        : `補堂 ${formatPendingMakeupFromDateLabel(toDate)} 尚未打勾`;
      const bucket = reschedulePendingByStudent.get(sid);
      if (bucket) bucket.details.push(line);
      else reschedulePendingByStudent.set(sid, { displayName: meta.displayName, details: [line] });
    }
  }

  const reschedulePendingRows: HomeReminderRow[] = Array.from(reschedulePendingByStudent.entries())
    .map(([studentId, { displayName, details }]) => ({
      studentId,
      displayName,
      detail: `${details.length} 堂：${details.join("；")}`,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-Hant"));

  const pendingLeaveRows: HomeReminderRow[] = [];
  for (const row of yearStateRows) {
    const sid = String(row.student_id ?? "");
    if (!sid) continue;
    const meta = activeStudentMetaById.get(sid);
    if (!meta) continue;
    const entries = Array.isArray(row.reschedule_entries)
      ? (row.reschedule_entries as unknown[])
      : [];
    for (const e of entries) {
      if (!isPendingRescheduleEntry(e as { toDate?: string; pending?: boolean })) continue;
      const fromDate = String((e as { fromDate?: string }).fromDate ?? "");
      if (!fromDate) continue;
      pendingLeaveRows.push({
        studentId: sid,
        displayName: meta.displayName,
        detail: `原課 ${formatPendingMakeupFromDateLabel(fromDate)}，${formatPendingMakeupReminderZh(fromDate, ymdToday)}`,
      });
    }
  }
  pendingLeaveRows.sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-Hant"));

  const tutorsBirthdayToday = (tutorRows ?? [])
    .filter((r) => {
      const status = String((r as { status?: string }).status ?? "").trim();
      return status === "工作中" || status === "放假中";
    })
    .filter((r) => String((r as { birth_date?: string }).birth_date ?? "").slice(5, 10) === mdToday)
    .map((r) => {
      const zh = String((r as { name_zh?: string }).name_zh ?? "").trim();
      const en = String((r as { name_en?: string }).name_en ?? "").trim();
      return zh || en || String(r.id ?? "");
    });

  const studentsBirthdayToday = activeStudentMeta
    .filter((student) => student.birthMd === mdToday)
    .map((student) => student.displayName);

  const birthdayLines = [
    ...studentsBirthdayToday.map((name) => `${name}（學生）`),
    ...tutorsBirthdayToday.map((name) => `${name}（導師）`),
  ];
  const birthdaySummary = birthdayLines.length ? birthdayLines.join("、") : "今日冇生日之星";
  const todayWhatsappMessage = birthdayLines.length
    ? `${birthdaySummary} 今日生日`
    : "今日冇生日之星";
  const todayWhatsappHref = `https://wa.me/85251646814?text=${encodeURIComponent(todayWhatsappMessage)}`;

  const allBirthdayRows = [
    ...activeStudentMeta.map((student) => ({
      md: student.birthMd,
      label: `${student.displayName}（學生）`,
    })),
    ...(tutorRows ?? [])
      .filter((r) => {
        const status = String((r as { status?: string }).status ?? "").trim();
        return status === "工作中" || status === "放假中";
      })
      .map((r) => {
        const zh = String((r as { name_zh?: string }).name_zh ?? "").trim();
        const en = String((r as { name_en?: string }).name_en ?? "").trim();
        return {
          md: String((r as { birth_date?: string }).birth_date ?? "").slice(5, 10),
          label: `${zh || en || String(r.id ?? "")}（導師）`,
        };
      }),
  ].filter((r) => r.md.length === 5);

  const birthdayLabelsByMd = new Map<string, string[]>();
  for (const row of allBirthdayRows) {
    const existing = birthdayLabelsByMd.get(row.md);
    if (existing) existing.push(row.label);
    else birthdayLabelsByMd.set(row.md, [row.label]);
  }

  const weekBirthdayLines: string[] = [];
  const weekBirthdayReminderItems: HomeWeekBirthdayItem[] = [];
  const hkTodayDate = new Date(`${ymdToday}T00:00:00+08:00`);
  const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];
  for (let offset = 1; offset <= 7; offset += 1) {
    const d = new Date(hkTodayDate);
    d.setDate(d.getDate() + offset);
    const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const names = birthdayLabelsByMd.get(md) ?? [];
    if (!names.length) continue;
    const dayName = weekdayNames[d.getDay()];
    const dateLabel = `${d.getDate()}/${d.getMonth() + 1}`;
    const dayLabel = offset === 1 ? "明天" : offset === 2 ? "後天" : `星期${dayName}`;
    weekBirthdayLines.push(`星期${dayName} ${dateLabel}：${names.join("、")}`);
    for (const name of names) {
      weekBirthdayReminderItems.push({
        id: `${md}-${name}`,
        dayLabel,
        dateLabel,
        personLabel: name,
      });
    }
    if (d.getDay() === 0) break;
  }

  const dayOfMonth = Number(ymdToday.slice(8, 10)) || 1;
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const daysLeftInMonth = lastDayOfMonth - dayOfMonth;
  const priorMakeupWindow = getPriorMonthMakeupWindow();

  return {
    ymdToday,
    mdToday,
    year,
    month,
    birthdaySummary,
    todayWhatsappHref,
    weekBirthdayLines,
    weekBirthdayReminderItems,
    unpaidRows,
    reschedulePendingRows,
    pendingLeaveRows,
    inactiveReturnRows,
    priorMakeupMonthLabel: `${Number(priorMakeupWindow.startIso.slice(5, 7))}月`,
    isMonthEndMakeupReminder: daysLeftInMonth <= 6,
    daysLeftInMonth,
  };
}

const fetchHomeDashboardCached = unstable_cache(
  fetchHomeDashboardUncached,
  ["home-dashboard-v2"],
  // Home dashboard is read-mostly; rely on manual cache-bust tags after edits/sync.
  { revalidate: 300, tags: [SCHEDULE_CACHE_TAG_HOME] },
);

export async function fetchHomeDashboardData(): Promise<HomeDashboardData> {
  return fetchHomeDashboardCached();
}
