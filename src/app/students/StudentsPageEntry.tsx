"use client";

import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import StudentsPageClient, { type StudentsPageInitialList } from "./StudentsPageClient";

export default function StudentsPageEntry({
  navViewer = null,
  initialList = null,
}: {
  navViewer?: AppTopNavViewer | null;
  initialList?: StudentsPageInitialList | null;
}) {
  return <StudentsPageClient navViewer={navViewer} initialList={initialList} />;
}
