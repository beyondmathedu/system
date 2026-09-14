"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { StudentLessonsBootstrapPayload } from "@/lib/lessonDataServer";

const StudentLessonsYearPage = dynamic(
  () => import("./StudentLessonsYearPage").then((m) => m.StudentLessonsYearPage),
  {
    loading: () => (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto max-w-[1400px] space-y-4">
          <div className="h-14 animate-pulse rounded-xl bg-white" />
          <div className="h-[32rem] animate-pulse rounded-2xl bg-white" />
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
