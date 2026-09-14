import { cache } from "react";
import { unstable_cache } from "next/cache";
import { homeBirthdayWhatsappHref } from "@/lib/homeBirthdayWhatsapp";
import { listUntickedRegularMakeupExtraInRange } from "@/lib/lesson2026Summary";
import { formatPendingMakeupFromDateLabel } from "@/lib/pendingMakeup";
import {
  SCHEDULE_CACHE_TAG_AGGREGATES,
  SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
  SCHEDULE_CACHE_TAG_HOME,
} from "@/lib/scheduleCacheTags";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildStudentInactivePeriodsById,
  isStudentInactiveOnDateFromPeriods,
  withAutoF6InactivePeriod,
  type StudentInactivePeriod,
} from "@/lib/studentVisibility";
import { loadYearScheduleData } from "@/lib/yearScheduleData.server";
import type { HomeReminderRow } from "@/app/home/HomeReminderPanel";
import type { YearLessonState } from "@/lib/yearScheduleCore";

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
  /** 6 月起至昨天，恆常／補堂／加堂已過期未打勾的學生 */
  untickedFromJuneRows: HomeReminderRow[];
};

type HomeActiveStudentMeta = {
  id: string;
  birthMd: string;
  displayName: string;
  grade: string;
};

type HomePeopleContext = {
  ymdToday: string;
  mdToday: string;
  year: number;
  month: number;
  activeStudentMeta: HomeActiveStudentMeta[];
  inactivePeriodsById: Record<string, StudentInactivePeriod[]>;
  tutorRows: Array<Record<string, unknown>>;
};

type HomeBirthdaySlice = {
  birthdaySummary: string;
  todayWhatsappHref: string;
  weekBirthdayLines: string[];
  weekBirthdayReminderItems: HomeWeekBirthdayItem[];
};

const EMPTY_YEAR_STATE: YearLessonState = {
  attendance: {},
  hiddenDates: {},
  overrides: {},
  rescheduleEntries: [],
  extraEntries: [],
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

function formatTutorBirthdayLabel(row: {
  id?: string | null;
  name?: string | null;
  name_zh?: string | null;
  name_en?: string | null;
  nickname_en?: string | null;
}): string {
  const zh = String(row.name_zh ?? "").trim();
  // Tutor page Nickname is stored in `name`; `nickname_en` is legacy.
  const nick = String(row.name ?? "").trim() || String(row.nickname_en ?? "").trim();
  const en = String(row.name_en ?? "").trim();
  const secondary = nick || en;
  const label = [zh, secondary].filter(Boolean).join(" ").trim();
  return label || String(row.id ?? "").trim() || "—";
}

function ymdYesterdayOf(ymdToday: string): string {
  const endExclusiveToday = new Date(`${ymdToday}T00:00:00+08:00`);
  endExclusiveToday.setDate(endExclusiveToday.getDate() - 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(endExclusiveToday);
}

async function fetchHomePeopleContextUncached(ymdToday: string): Promise<HomePeopleContext> {
  const year = Number(ymdToday.slice(0, 4)) || new Date().getFullYear();
  const month = Number(ymdToday.slice(5, 7)) || 1;
  const mdToday = ymdToday.slice(5, 10);
  const supabase = getSupabaseAdmin();

  const [{ data: studentRows }, { data: tutorRows }, { data: periodRows }] = await Promise.all([
    supabase.from("students").select("id, name_zh, name_en, nickname_en, birth_date, grade"),
    supabase.from("tutors").select("id, name, name_zh, name_en, nickname_en, birth_date, status"),
    supabase.from("student_visibility_periods").select("student_id, start_date, end_date, note"),
  ]);

  const inactivePeriodsById = buildStudentInactivePeriodsById(periodRows ?? []);

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
      grade: String((r as { grade?: string }).grade ?? ""),
    };
  });

  return {
    ymdToday,
    mdToday,
    year,
    month,
    activeStudentMeta,
    inactivePeriodsById,
    tutorRows: (tutorRows ?? []) as Array<Record<string, unknown>>,
  };
}

function buildBirthdaySlice(people: HomePeopleContext): HomeBirthdaySlice {
  const { ymdToday, mdToday, activeStudentMeta, tutorRows } = people;

  const tutorsBirthdayToday = tutorRows
    .filter((r) => {
      const status = String(r.status ?? "").trim();
      return status === "工作中" || status === "放假中";
    })
    .filter((r) => String(r.birth_date ?? "").slice(5, 10) === mdToday)
    .map((r) => formatTutorBirthdayLabel(r as Parameters<typeof formatTutorBirthdayLabel>[0]));

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
  const todayWhatsappHref = homeBirthdayWhatsappHref(todayWhatsappMessage);

  const allBirthdayRows = [
    ...activeStudentMeta.map((student) => ({
      md: student.birthMd,
      label: `${student.displayName}（學生）`,
    })),
    ...tutorRows
      .filter((r) => {
        const status = String(r.status ?? "").trim();
        return status === "工作中" || status === "放假中";
      })
      .map((r) => ({
        md: String(r.birth_date ?? "").slice(5, 10),
        label: `${formatTutorBirthdayLabel(r as Parameters<typeof formatTutorBirthdayLabel>[0])}（導師）`,
      })),
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

  return {
    birthdaySummary,
    todayWhatsappHref,
    weekBirthdayLines,
    weekBirthdayReminderItems,
  };
}

function buildUntickedRows(people: HomePeopleContext, scheduleData: Awaited<ReturnType<typeof loadYearScheduleData>>): HomeReminderRow[] {
  const { ymdToday, year, activeStudentMeta, inactivePeriodsById } = people;
  const juneStartIso = `${year}-06-01`;
  const ymdYesterday = ymdYesterdayOf(ymdToday);
  const untickedFromJuneRows: HomeReminderRow[] = [];

  for (const meta of activeStudentMeta) {
    const periods = withAutoF6InactivePeriod({
      periods: inactivePeriodsById[meta.id] ?? [],
      studentId: meta.id,
      grade: meta.grade,
      year,
    });
    const records = scheduleData.normalizedRecordsById[meta.id] ?? [];
    const state = scheduleData.stateById[meta.id] ?? EMPTY_YEAR_STATE;
    const unticked = listUntickedRegularMakeupExtraInRange(
      records,
      state,
      juneStartIso,
      ymdYesterday,
      year,
      {
        isDateInactive: (dateIso) =>
          isStudentInactiveOnDateFromPeriods({ periods, dateIso }),
      },
    );
    if (!unticked.length) continue;
    const details = unticked.map(
      (r) => `${formatPendingMakeupFromDateLabel(r.date)}（${r.lessonType}）`,
    );
    untickedFromJuneRows.push({
      studentId: meta.id,
      displayName: meta.displayName,
      count: details.length,
      detail: `${details.length} 堂：${details.join("、")}`,
    });
  }

  untickedFromJuneRows.sort((a, b) => {
    const countA = a.count ?? 0;
    const countB = b.count ?? 0;
    if (countB !== countA) return countB - countA;
    return a.displayName.localeCompare(b.displayName, "zh-Hant");
  });

  return untickedFromJuneRows;
}

async function loadHomePeopleContextCached(ymdToday: string): Promise<HomePeopleContext> {
  return unstable_cache(
    () => fetchHomePeopleContextUncached(ymdToday),
    ["home-people-v1", ymdToday],
    { revalidate: 120, tags: [SCHEDULE_CACHE_TAG_HOME] },
  )();
}

async function loadHomeBirthdaySliceCached(ymdToday: string): Promise<HomeBirthdaySlice> {
  return unstable_cache(
    async () => {
      const people = await loadHomePeopleContextCached(ymdToday);
      return buildBirthdaySlice(people);
    },
    ["home-birthday-v1", ymdToday],
    { revalidate: 120, tags: [SCHEDULE_CACHE_TAG_HOME] },
  )();
}

async function loadHomeUntickedSliceCached(ymdToday: string): Promise<HomeReminderRow[]> {
  const year = Number(ymdToday.slice(0, 4)) || new Date().getFullYear();
  return unstable_cache(
    async () => {
      const [people, scheduleData] = await Promise.all([
        loadHomePeopleContextCached(ymdToday),
        loadYearScheduleData(year),
      ]);
      return buildUntickedRows(people, scheduleData);
    },
    ["home-unticked-v1", ymdToday],
    {
      revalidate: 60,
      tags: [SCHEDULE_CACHE_TAG_HOME, SCHEDULE_CACHE_TAG_DAY_TIMETABLE, SCHEDULE_CACHE_TAG_AGGREGATES],
    },
  )();
}

export const fetchHomeBirthdayPart = cache(async (): Promise<{
  ymdToday: string;
  mdToday: string;
  year: number;
  month: number;
} & HomeBirthdaySlice> => {
  const { ymdToday, mdToday, year, month } = hkTodayParts();
  const birthday = await loadHomeBirthdaySliceCached(ymdToday);
  return { ymdToday, mdToday, year, month, ...birthday };
});

export const fetchHomeUntickedPart = cache(async (): Promise<HomeReminderRow[]> => {
  const { ymdToday } = hkTodayParts();
  return loadHomeUntickedSliceCached(ymdToday);
});

export const fetchHomeDashboardData = cache(async (): Promise<HomeDashboardData> => {
  const [{ ymdToday, mdToday, year, month, ...birthday }, untickedFromJuneRows] = await Promise.all([
    fetchHomeBirthdayPart(),
    fetchHomeUntickedPart(),
  ]);

  return {
    ymdToday,
    mdToday,
    year,
    month,
    birthdaySummary: birthday.birthdaySummary,
    todayWhatsappHref: birthday.todayWhatsappHref,
    weekBirthdayLines: birthday.weekBirthdayLines,
    weekBirthdayReminderItems: birthday.weekBirthdayReminderItems,
    untickedFromJuneRows,
  };
});
