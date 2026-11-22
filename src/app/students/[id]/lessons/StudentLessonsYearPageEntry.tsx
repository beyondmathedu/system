"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { StudentLessonsBootstrapPayload } from "@/lib/lessonDataServer";

const StudentLessonsYearPage = dynamic(
  () =>
    import("./StudentLessonsYearPage").then((m) => ({
      default: m.StudentLessonsYearPage,
    })),
  {
    loading: () => (
      <div className="min-h-screen bg-slate-100 px-3 py-10 sm:px-5 lg:px-6" aria-busy="true">
        <div className="mx-auto w-full max-w-[1500px] space-y-4">
          <div className="h-12 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-24 animate-pulse rounded-xl bg-white" />
          <div className="h-96 animate-pulse rounded-xl bg-white" />
        </div>
      </div>
    ),
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
