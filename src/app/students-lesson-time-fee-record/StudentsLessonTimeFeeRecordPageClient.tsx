"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { FeeRecordBootstrapApiBody } from "@/lib/feeRecordBootstrapHydrate";

function StudentsLessonTimeFeeRecordSkeleton() {
  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <div className="mb-4 h-14 rounded-lg bg-slate-200/50" aria-hidden />
        <div className="min-h-[50vh] rounded-xl border border-slate-200 bg-white shadow-sm" aria-hidden />
      </div>
    </div>
  );
}

const StudentsLessonTimeFeeRecordClient = dynamic(
  () => import("./StudentsLessonTimeFeeRecordClient"),
  {
    loading: StudentsLessonTimeFeeRecordSkeleton,
  },
);

export default function StudentsLessonTimeFeeRecordPageClient({
  initialBootstrap,
  initialYear,
  initialMonth,
  navViewer,
}: {
  initialBootstrap: FeeRecordBootstrapApiBody;
  initialYear: number;
  initialMonth: number;
  navViewer?: AppTopNavViewer | null;
}) {
  return (
    <StudentsLessonTimeFeeRecordClient
      initialBootstrap={initialBootstrap}
      initialYear={initialYear}
      initialMonth={initialMonth}
      navViewer={navViewer}
    />
  );
}
