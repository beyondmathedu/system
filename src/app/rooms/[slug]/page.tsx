import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import BackNavButton from "@/components/BackNavButton";
import { fetchClassroomMeta } from "@/lib/classroomsRegistry";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { defaultLessonYear, parseLessonYear } from "@/lib/lessonCalendar";
import { readMonthPart, readYmdParts } from "@/lib/intlFormatParts";
import { normalizeStudentId } from "@/lib/studentId";
import { studentPortalHomePath } from "@/lib/studentPortalAccess";
import { fetchRoomScheduleAggregate } from "@/lib/roomScheduleAggregate";
import { defaultDailyTimetablePath, getTutorLandingPath, tutorCanAccessRoomSlug } from "@/lib/tutorRoomAccess";
import RoomScheduleTable from "./RoomScheduleTable";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hkMonthNow(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
  }).formatToParts(new Date());
  return Number(readMonthPart(parts, "1")) || 1;
}

function hkTodayIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const { y, m, d } = readYmdParts(parts, {
    y: String(defaultLessonYear()),
    m: "01",
    d: "01",
  });
  return `${y}-${m}-${d}`;
}

function mondayToSundayRange(iso: string): { startIso: string; endIso: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { startIso: iso, endIso: iso };
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const js = dt.getDay(); // Sun=0
  const offsetToMonday = js === 0 ? -6 : 1 - js;
  const start = new Date(dt);
  start.setDate(dt.getDate() + offsetToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const toIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { startIso: toIso(start), endIso: toIso(end) };
}

function formatIsoRangeShort(startIso: string, endIso: string): string {
  const parse = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    return { month: Number(m[2]), day: Number(m[3]) };
  };
  const a = parse(startIso);
  const b = parse(endIso);
  if (!a || !b) return `${startIso} - ${endIso}`;
  const left = `${a.day} ${MONTH_SHORT[Math.max(0, Math.min(11, a.month - 1))]}`;
  const right = `${b.day} ${MONTH_SHORT[Math.max(0, Math.min(11, b.month - 1))]}`;
  if (a.month === b.month) return `${a.day} - ${b.day} ${MONTH_SHORT[a.month - 1]}`;
  return `${left} - ${right}`;
}

function parseYearMonth(sp: { year?: string; month?: string } | undefined): {
  year: number;
  month: number;
} {
  const monthRaw = sp?.month ? Number(sp.month) : hkMonthNow();
  const year = parseLessonYear(sp?.year, defaultLessonYear());
  let month = Number.isFinite(monthRaw) ? Math.floor(monthRaw) : hkMonthNow();
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return { year, month };
}

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ year?: string; month?: string; period?: string; from?: string; to?: string }>;
};

export default async function RoomPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const key = slug.toLowerCase();
  const [room, viewer] = await Promise.all([fetchClassroomMeta(key), getViewerContext()]);
  if (!room) notFound();

  const { year, month } = parseYearMonth(sp);
  const isSharedIpadTutor = viewer.isSharedIpadTutor;
  const isAdminViewer = viewer.role === "admin";
  const isTutorView = viewer.role === "tutor";
  const isRoomStaffView = isTutorView || isSharedIpadTutor;
  const canUsePeriodNav = !isTutorView || isSharedIpadTutor;
  const periodRaw = String(sp?.period ?? "").toLowerCase();
  const period =
    canUsePeriodNav &&
    (periodRaw === "today" || periodRaw === "week" || periodRaw === "month" || periodRaw === "custom")
      ? periodRaw
      : isTutorView
        ? "month"
        : "today";
  const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const fromIso = String(sp?.from ?? "");
  const toIso = String(sp?.to ?? "");
  const hasCustomRange = period === "custom" && isIsoDate(fromIso) && isIsoDate(toIso) && fromIso <= toIso;
  const nextHref =
    `/rooms/${encodeURIComponent(key)}?year=${year}&month=${month}&period=${period}` +
    (hasCustomRange ? `&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}` : "");
  if (!viewer.userId) redirect(`/login?next=${encodeURIComponent(nextHref)}`);
  if (viewer.role === "student" && viewer.studentId) {
    redirect(studentPortalHomePath(normalizeStudentId(viewer.studentId)));
  }
  if (!viewer.isSharedIpadTutor && viewer.role !== "admin" && viewer.role !== "tutor") {
    redirect("/login");
  }
  if (!tutorCanAccessRoomSlug(viewer, key)) {
    redirect(getTutorLandingPath(viewer) ?? defaultDailyTimetablePath());
  }
  const todayIso = hkTodayIso();
  const range = (() => {
    if (period === "month") return { startIso: "", endIso: "" };
    if (period === "today") return { startIso: todayIso, endIso: todayIso };
    if (period === "custom" && hasCustomRange) return { startIso: fromIso, endIso: toIso };
    return mondayToSundayRange(todayIso);
  })();
  const { rows, loadError } = await fetchRoomScheduleAggregate(key, year, month, range);
  const navViewer = await buildAppTopNavViewer(viewer);

  const basePath = `/rooms/${key}`;
  const titleSuffix = (() => {
    if (period === "month") return `${year} ${MONTH_SHORT[month - 1]}`;
    if (period === "today") return `Today (${todayIso})`;
    if (period === "custom" && hasCustomRange) {
      return `Period (${formatIsoRangeShort(range.startIso, range.endIso)})`;
    }
    return `This Week (${formatIsoRangeShort(range.startIso, range.endIso)})`;
  })();
  const summaryPrefix = (() => {
    if (period === "month") return "This month";
    if (period === "today") return "Today";
    if (period === "custom" && hasCustomRange) return "Selected period";
    return "This week";
  })();

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="room" viewer={navViewer} />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <div className="flex flex-wrap items-center gap-3">
              {!isSharedIpadTutor ? (
                <BackNavButton
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-xl font-bold leading-none hover:bg-white/30"
                  ariaLabel="Go back"
                  fallbackHref="/students"
                >
                  ←
                </BackNavButton>
              ) : null}
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold tracking-tight">
                  Classroom {room.id ? `${room.id} · ` : ""}
                  {room.label} · {titleSuffix}
                </h1>
                <p className="mt-1 text-sm text-blue-100">{room.description}</p>
                <p className="mt-2 text-xs text-blue-100/90">
                  Data comes from student lesson schedules and Supabase; sorting order: date → time → type (regular /
                  makeup / extra) → grade (F.6 → F.1).
                </p>
              </div>
            </div>
          </div>

          {canUsePeriodNav ? (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { key: "today", label: "Today" },
                    { key: "week", label: "This Week" },
                    { key: "month", label: "This Month" },
                  ].map((item) => {
                    const active = period === item.key;
                    return (
                      <Link
                        key={item.key}
                        href={`${basePath}?year=${year}&month=${month}&period=${item.key}`}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          active
                            ? "bg-slate-800 text-white"
                            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
                <form method="get" className="flex flex-wrap items-center gap-1.5" suppressHydrationWarning>
                  <input type="hidden" name="year" value={String(year)} />
                  <input type="hidden" name="month" value={String(month)} />
                  <input type="hidden" name="period" value="custom" />
                  <span className="text-xs font-semibold text-slate-600">Period</span>
                  <input
                    type="date"
                    name="from"
                    defaultValue={hasCustomRange ? range.startIso : todayIso}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  />
                  <span className="text-xs text-slate-500">to</span>
                  <input
                    type="date"
                    name="to"
                    defaultValue={hasCustomRange ? range.endIso : todayIso}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    suppressHydrationWarning
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path d="M16.78 5.22a.75.75 0 010 1.06l-8.5 8.5a.75.75 0 01-1.06 0l-4-4a.75.75 0 111.06-1.06l3.47 3.47 7.97-7.97a.75.75 0 011.06 0z" />
                    </svg>
                    Apply
                  </button>
                </form>
                {period === "month" ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-600">Year:</span>
                  <span className="rounded-lg bg-[#1d76c2] px-2.5 py-1 text-sm font-semibold text-white">
                    {year}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MONTH_SHORT.map((label, i) => {
                    const m = i + 1;
                    const active = m === month;
                    return (
                      <Link
                        key={label}
                            href={`${basePath}?year=${year}&month=${m}&period=month`}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          active
                            ? "bg-slate-800 text-white"
                            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="p-4 sm:p-6">
            {loadError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                Failed to load data: {loadError}
              </p>
            ) : null}

            <p className="mb-4 text-sm text-slate-600">
              {summaryPrefix} this classroom has <span className="font-semibold text-slate-900">{rows.length}</span>{" "}
              lessons (regular / makeup / extra).
            </p>

            {rows.length === 0 && !loadError ? (
              <p className="text-slate-600">No lessons found for this period in this classroom.</p>
            ) : null}

            {rows.length > 0 ? (
              <RoomScheduleTable
                rows={rows}
                year={year}
                canOpenStudentLink={isSharedIpadTutor || isAdminViewer}
                studentLessonsHrefMode={isAdminViewer ? "hub" : "yearFromRoom"}
                hideStudentId={isSharedIpadTutor}
                attendanceLocked={isRoomStaffView && !isSharedIpadTutor}
                tutorFieldLocked={isRoomStaffView}
                allowSummaryEdit={isRoomStaffView}
              />
            ) : null}

          </div>
        </div>
      </div>
    </div>
  );
}
