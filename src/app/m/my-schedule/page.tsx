import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";
import { loadMobileStudentUpcoming } from "@/lib/mobileStudentSchedule.server";
import { normalizeStudentId } from "@/lib/studentId";
import { formatDateSlash } from "@/lib/yearScheduleCore";

export const dynamic = "force-dynamic";

function weekdayLabel(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[new Date(y!, m! - 1, d!).getDay()] ?? "";
}

export default async function MobileStudentSchedulePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/m/my-schedule");
  if (viewer.role !== "student" || !viewer.studentId) {
    redirect("/m");
  }

  const studentId = normalizeStudentId(viewer.studentId);
  const payload = await loadMobileStudentUpcoming(studentId, 21);

  const byDate = new Map<string, typeof payload.rows>();
  for (const r of payload.rows) {
    const list = byDate.get(r.dateIso) ?? [];
    list.push(r);
    byDate.set(r.dateIso, list);
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-3 pb-10 pt-4">
        <header className="rounded-2xl bg-[#1d76c2] px-4 py-4 text-white shadow-sm">
          <p className="text-xs font-medium text-blue-100">Phone · My schedule</p>
          <h1 className="text-xl font-bold tracking-tight">Upcoming lessons</h1>
          <p className="mt-1 text-sm text-blue-100">
            {payload.dateIso} → {payload.endIso} · read only
          </p>
        </header>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/students/${encodeURIComponent(studentId)}/lessons`}
            className="rounded-lg px-3 py-2 font-medium text-slate-600 ring-1 ring-slate-200"
          >
            Full lesson page
          </Link>
        </div>

        {payload.loadError ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {payload.loadError}
          </p>
        ) : null}

        {byDate.size === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">
            No upcoming lessons in the next 3 weeks.
          </p>
        ) : (
          [...byDate.entries()].map(([dateIso, rows]) => (
            <section
              key={dateIso}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">
                {formatDateSlash(dateIso)} · {weekdayLabel(dateIso)}
              </div>
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <li key={r.rowId} className="px-3 py-3">
                    <p className="text-base font-semibold text-slate-900">
                      {r.time} · {r.room}
                    </p>
                    <p className="text-sm text-slate-600">
                      {r.tutorDisplay || "待定"} · {r.lessonType}
                    </p>
                    {r.noteDisplay ? (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{r.noteDisplay}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
