"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { FeeRecordBootstrapPayload } from "@/lib/lessonDataServer";

const StudentsLessonTimeFeeRecordClient = dynamic(
  () => import("./StudentsLessonTimeFeeRecordClient"),
  {
    loading: () => (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto max-w-[1400px] space-y-4">
          <div className="h-14 animate-pulse rounded-xl bg-white" />
          <div className="h-[36rem] animate-pulse rounded-2xl bg-white" />
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
