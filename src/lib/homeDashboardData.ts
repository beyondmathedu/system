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
import { resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";
import type { HomeReminderRow } from "@/app/home/HomeReminderPanel";

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

async function fetchHomeDashboardUncached(): Promise<HomeDashboardData> {
  const { ymdToday, mdToday, year, month } = hkTodayParts();
  const supabase = getSupabaseAdmin();

  const [
    { data: studentRows },
    { data: tutorRows },
    { data: visibilityRows },
    { data: feeRowsAll },
    { data: yearStateRowsAll },
  ] = await Promise.all([
    supabase.from("students").select("id, name_zh, name_en, nickname_en, birth_date, grade"),
    supabase.from("tutors").select("id, name_zh, name_en, birth_date, status"),
    supabase.from("student_visibility_modes").select("student_id, mode, effective_date"),
    supabase
      .from("student_monthly_fee_records")
      .select("student_id, submitted_amount")
      .eq("year", year)
      .eq("month", month),
    supabase
      .from("student_lessons_year_state")
      .select("student_id, attendance, reschedule_entries")
      .eq("year", year),
  ]);

  const manualInactiveEffectiveById = new Map<string, string>();
  for (const row of visibilityRows ?? []) {
    const mode = String((row as { mode?: string }).mode ?? "").toLowerCase();
    const sid = String((row as { student_id?: string }).student_id ?? "");
    const eff = String((row as { effective_date?: string }).effective_date ?? "");
    if (mode === "inactive" && sid && eff) manualInactiveEffectiveById.set(sid, eff);
  }

  const activeStudentRows = (studentRows ?? []).filter((r) => {
    const sid = String(r.id ?? "");
    const grade = String((r as { grade?: string }).grade ?? "");
    const inactiveEffective = resolveStudentInactiveEffectiveDate({
      grade,
      manualInactiveEffective: manualInactiveEffectiveById.get(sid) ?? null,
      year,
    });
    return !(inactiveEffective && inactiveEffective <= ymdToday);
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

  const paidAmountByStudentId = new Map<string, number>();
  for (const row of feeRowsAll ?? []) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!activeStudentIdSet.has(sid)) continue;
    paidAmountByStudentId.set(sid, Number((row as { submitted_amount?: number }).submitted_amount ?? 0) || 0);
  }

  const unpaidRows: HomeReminderRow[] = activeStudentMeta
    .filter((student) => (paidAmountByStudentId.get(student.id) ?? 0) <= 0)
    .map((student) => ({
      studentId: student.id,
      displayName: student.displayName,
      detail: `${month} 月學費紀錄 Tuition Paid ≤ $0（未交或 Zoho 未同步到）`,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-Hant"));

  const yearStateRows = (yearStateRowsAll ?? []).filter((row) =>
    activeStudentIdSet.has(String((row as { student_id?: string }).student_id ?? "")),
  );

  const reschedulePendingByStudent = new Map<string, { displayName: string; details: string[] }>();
  for (const row of yearStateRows) {
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    const meta = activeStudentMetaById.get(sid);
    if (!meta) continue;
    const attendance = ((row as { attendance?: Record<string, boolean> }).attendance ?? {}) as Record<
      string,
      boolean
    >;
    const entries = Array.isArray((row as { reschedule_entries?: unknown }).reschedule_entries)
      ? (row as { reschedule_entries: unknown[] }).reschedule_entries
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
    const sid = String((row as { student_id?: string }).student_id ?? "");
    if (!sid) continue;
    const meta = activeStudentMetaById.get(sid);
    if (!meta) continue;
    const entries = Array.isArray((row as { reschedule_entries?: unknown }).reschedule_entries)
      ? (row as { reschedule_entries: unknown[] }).reschedule_entries
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
    priorMakeupMonthLabel: `${Number(priorMakeupWindow.startIso.slice(5, 7))}月`,
    isMonthEndMakeupReminder: daysLeftInMonth <= 6,
    daysLeftInMonth,
  };
}

const fetchHomeDashboardCached = unstable_cache(
  fetchHomeDashboardUncached,
  ["home-dashboard-v1"],
  { revalidate: 90, tags: [SCHEDULE_CACHE_TAG_HOME] },
);

export async function fetchHomeDashboardData(): Promise<HomeDashboardData> {
  return fetchHomeDashboardCached();
}
