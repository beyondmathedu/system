"use client";

import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { StudentLessonsBootstrapPayload } from "@/lib/lessonDataServer";
import { StudentLessonsYearPage } from "./StudentLessonsYearPage";

export function StudentLessonsYearPageEntry(props: {
  targetYear?: number;
  initialBootstrap?: StudentLessonsBootstrapPayload | null;
  initialReadOnly?: boolean;
  navViewer?: AppTopNavViewer | null;
}) {
  return <StudentLessonsYearPage {...props} />;
}
