import Link from "next/link";
import { redirect } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import DayTimetableTable from "@/components/DayTimetableTable";
import PageDatePicker from "@/components/PageDatePicker";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { getViewerContext } from "@/lib/authz";
import { fetchDayTimetablePayload, parseDayParams } from "@/lib/dayTimetableGrid";
import { normalizeStudentId } from "@/lib/studentId";

type PageProps = {
  searchParams?: Promise<{ year?: string; month?: string; day?: string }>;
};

function shiftDay(year: number, month: number, day: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

export default async function RegularClassTimetablePage({ searchParams }: PageProps) {
  const sp = searchParams ? await searchParams : undefined;
  const { year, month, day } = parseDayParams(sp);
  const viewer = await getViewerContext();
  const nextHref = `/regular-class-timetable?year=${year}&month=${month}&day=${day}`;
  if (!viewer.userId) redirect(`/login?next=${encodeURIComponent(nextHref)}`);
  if (viewer.role === "student" && viewer.studentId) {
    redirect(`/students/${encodeURIComponent(normalizeStudentId(viewer.studentId))}/lessons/2026`);
  }
  if (viewer.role !== "admin" && viewer.role !== "tutor") {
    redirect("/login");
  }
  const payload = await fetchDayTimetablePayload(year, month, day, { regularOnly: true });
  const prev = shiftDay(year, month, day, -1);
  const next = shiftDay(year, month, day, 1);
  const base = "/regular-class-timetable";

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="dashboard" />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">{payload.titleDate} 恆常班時間表</h1>
            <p className="mt-1 text-sm text-blue-100">
              版面與 Daily Timetable 相同，但<strong className="font-semibold">只顯示恆常排課</strong>
              （不含補堂、加堂）。每個時段下方有各房「恆常／上限／餘額」，上限在{" "}
              <span className="font-semibold">Rooms</span> 設定。考試日期欄與 Daily 相同。
            </p>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link
                  href={`${base}?year=${prev.y}&month=${prev.m}&day=${prev.d}`}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  昨天
                </Link>
                <span className="text-slate-500">日期</span>
                <PageDatePicker basePath={base} year={year} month={month} day={day} />
                <Link
                  href={`${base}?year=${next.y}&month=${next.m}&day=${next.d}`}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  明天
                </Link>
              </div>
              <div className="text-right text-xs text-slate-600">
                <p>選擇年／月／日</p>
                <p className="mt-0.5 font-semibold text-slate-800">
                  {year}年{String(month).padStart(2, "0")}月{String(day).padStart(2, "0")}日
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 text-sm font-bold text-slate-700">恆常班課堂（當日）</div>
              <DayTimetableTable
                key={payload.dateIso}
                payload={payload}
                emptyMessage="這一天沒有恆常排課。"
                showRegularCapacitySummary
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
