"use client";

import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { FeeRecordBootstrapPayload } from "@/lib/lessonDataServer";
import StudentsLessonTimeFeeRecordClient from "./StudentsLessonTimeFeeRecordClient";

export default function StudentsLessonTimeFeeRecordEntry(props: {
  initialBootstrap: FeeRecordBootstrapPayload;
  initialYear: number;
  initialMonth: number;
  navViewer: AppTopNavViewer | null;
}) {
  return <StudentsLessonTimeFeeRecordClient {...props} />;
}
