import Link from "next/link";
import AppTopNav from "@/components/AppTopNav";
import MultiStudentFirstAmountEditor from "@/components/MultiStudentFirstAmountEditor";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { loadMultiStudentFirstAmount } from "@/lib/payrollSettings";
import {
  fetchTutorsForMonthlyLessonNav,
  TUTOR_NAV_STATUS_LABEL,
  tutorNavStatusBadgeClass,
  type TutorNavStatus,
} from "@/lib/tutorMonthlyNav";

export const dynamic = "force-dynamic";

const SECTION_ORDER: TutorNavStatus[] = ["工作中", "放假中", "已解僱"];

export default async function TutorMonthlyLessonRecordPage() {
  const [{ tutors }, firstSeatAmount] = await Promise.all([
    fetchTutorsForMonthlyLessonNav(),
    loadMultiStudentFirstAmount(),
  ]);

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">Tutor Monthly Record</h1>
            <p className="mt-1 text-sm text-blue-100">
              Choose a tutor to view monthly lesson details expanded from schedules. This page shows{" "}
              <strong className="text-white">all tutors</strong>; MPF on the{" "}
              <Link href="/tutor" className="underline hover:text-white">
                Tutor
              </Link>{" "}
              page is used for 5% calculations only.{" "}
              Status groups follow the Tutor page (Active → Occasional → Inactive, then by ID).
            </p>
            <p className="mt-2 text-xs text-blue-100/95">
              Subtotal rule: single-student lessons use the Tutor page <strong>Single Student Rate</strong>; for
              multi-student lessons, the <strong>lowest-grade student</strong> uses the setting below (currently
              ${firstSeatAmount}), and others use that tutor&apos;s <strong>Junior/Senior Rate</strong>.
            </p>
          </div>

          <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
            <MultiStudentFirstAmountEditor initialValue={firstSeatAmount} />
          </div>

          <div className="p-6">
            {tutors.length === 0 ? (
              <p className="text-sm text-slate-600">No tutor records yet.</p>
            ) : (
              <div className="space-y-8">
                {SECTION_ORDER.map((status) => {
                  const list = tutors.filter((t) => t.status === status);
                  if (!list.length) return null;
                  return (
                    <section key={status}>
                      <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-800">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${tutorNavStatusBadgeClass(status)}`}
                        >
                          {TUTOR_NAV_STATUS_LABEL[status]}
                        </span>
                      </h2>
                      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {list.map((t) => (
                          <li key={t.id}>
                            <Link
                              href={`/tutor-monthly-lesson-record/${encodeURIComponent(t.id)}`}
                              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm font-medium text-[#1d76c2] hover:border-[#1d76c2]/40 hover:bg-white"
                            >
                              <span className="truncate text-slate-900">{t.displayName}</span>
                              <span className="shrink-0 font-mono text-xs text-slate-500">{t.id}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
