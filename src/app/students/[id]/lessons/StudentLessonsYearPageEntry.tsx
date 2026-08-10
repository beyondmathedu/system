"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { StudentLessonsBootstrapPayload } from "@/lib/lessonDataServer";

function StudentLessonsYearPageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <div className="mb-4 h-14 animate-pulse rounded-lg bg-slate-200/60" aria-hidden />
        <div
          className="min-h-[50vh] animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm"
          aria-hidden
        />
      </div>
    </div>
  );
}

const StudentLessonsYearPage = dynamic(
  () => import("./StudentLessonsYearPage").then((mod) => ({ default: mod.StudentLessonsYearPage })),
  {
    ssr: false,
    loading: StudentLessonsYearPageSkeleton,
  },
);

export function StudentLessonsYearPageEntry(props: {
  targetYear?: number;
  initialBootstrap?: StudentLessonsBootstrapPayload | null;
  initialReadOnly?: boolean;
  navViewer?: AppTopNavViewer | null;
}) {
  return <StudentLessonsYearPage {...props} />;
}
