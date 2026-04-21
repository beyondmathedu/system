import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import BackNavButton from "@/components/BackNavButton";
import { fetchClassroomMeta } from "@/lib/classroomsRegistry";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { getViewerContext } from "@/lib/authz";
import { fetchRoomScheduleAggregate } from "@/lib/roomScheduleAggregate";
import { readMonthPart } from "@/lib/intlFormatParts";
import { normalizeStudentId } from "@/lib/studentId";
import RoomScheduleTable from "./RoomScheduleTable";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hkMonthNow(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
  }).formatToParts(new Date());
  return Number(readMonthPart(parts, "1")) || 1;
}

function parseYearMonth(sp: { year?: string; month?: string } | undefined): {
  year: number;
  month: number;
} {
  const monthRaw = sp?.month ? Number(sp.month) : hkMonthNow();
  const year = 2026;
  let month = Number.isFinite(monthRaw) ? Math.floor(monthRaw) : hkMonthNow();
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return { year, month };
}

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ year?: string; month?: string }>;
};

export default async function RoomPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const key = slug.toLowerCase();
  const room = await fetchClassroomMeta(key);
  if (!room) notFound();

  const { year, month } = parseYearMonth(sp);
  const viewer = await getViewerContext();
  const nextHref = `/rooms/${encodeURIComponent(key)}?year=${year}&month=${month}`;
  if (!viewer.userId) redirect(`/login?next=${encodeURIComponent(nextHref)}`);
  if (viewer.role === "student" && viewer.studentId) {
    redirect(`/students/${encodeURIComponent(normalizeStudentId(viewer.studentId))}/lessons/2026`);
  }
  if (viewer.role !== "admin" && viewer.role !== "tutor") {
    redirect("/login");
  }
  if (viewer.role === "tutor") {
    const allowed = new Set(viewer.allowedRoomSlugs.map((s) => s.toLowerCase()));
    if (!allowed.has(key.toLowerCase())) redirect("/rooms");
  }
  const { rows, loadError } = await fetchRoomScheduleAggregate(key, year, month);
  const isTutorView = viewer.role === "tutor";

  const basePath = `/rooms/${key}`;

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="room" />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <div className="flex flex-wrap items-center gap-3">
              <BackNavButton
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-xl font-bold leading-none hover:bg-white/30"
                ariaLabel="返回上一頁"
                fallbackHref="/students"
              >
                ←
              </BackNavButton>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold tracking-tight">
                  Room {room.id ? `${room.id} · ` : ""}
                  {room.label} · {year} 年 {month} 月
                </h1>
                <p className="mt-1 text-sm text-blue-100">{room.description}</p>
                <p className="mt-2 text-xs text-blue-100/90">
                  資料來自各學生課表與 Supabase；排序：日期 → 時間 → 類型（恆常／補堂／加堂）→ 年級（F.6→F.1）。
                </p>
              </div>
            </div>
          </div>

          {!isTutorView ? (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-600">年份：</span>
                  <span className="rounded-lg bg-[#1d76c2] px-2.5 py-1 text-sm font-semibold text-white">
                    2026
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MONTH_SHORT.map((label, i) => {
                    const m = i + 1;
                    const active = m === month;
                    return (
                      <Link
                        key={label}
                        href={`${basePath}?year=${year}&month=${m}`}
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
            </div>
          ) : null}

          <div className="p-4 sm:p-6">
            {loadError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                無法載入資料：{loadError}
              </p>
            ) : null}

            <p className="mb-4 text-sm text-slate-600">
              本月本房共 <span className="font-semibold text-slate-900">{rows.length}</span>{" "}
              節（含恆常／補堂／加堂）。
            </p>

            {rows.length === 0 && !loadError ? (
              <p className="text-slate-600">本月沒有排在此教室的課堂。</p>
            ) : null}

            {rows.length > 0 ? (
              <RoomScheduleTable rows={rows} year={year} canOpenStudentLink={!isTutorView} readOnly={isTutorView} />
            ) : null}

            <Link
              href="/students"
              className="mt-6 inline-block rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              返回 Students
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
