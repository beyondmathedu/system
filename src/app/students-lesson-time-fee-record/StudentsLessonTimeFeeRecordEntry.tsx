"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { FeeRecordBootstrapPayload } from "@/lib/lessonDataServer";

const StudentsLessonTimeFeeRecordClient = dynamic(
  () => import("./StudentsLessonTimeFeeRecordClient"),
  {
    loading: () => (
      <div className="min-h-screen bg-slate-100 px-3 py-10 sm:px-5 lg:px-6" aria-busy="true">
        <div className="mx-auto w-full max-w-[1500px] space-y-4">
          <div className="h-12 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-20 animate-pulse rounded-xl bg-white" />
          <div className="h-[28rem] animate-pulse rounded-xl bg-white" />
        </div>
      </div>
    ),
  },
);

export default function StudentsLessonTimeFeeRecordEntry(props: {
  initialBootstrap: FeeRecordBootstrapPayload;
  initialYear: number;
  initialMonth: number;
  navViewer: AppTopNavViewer | null;
}) {
  return <StudentsLessonTimeFeeRecordClient {...props} />;
}
