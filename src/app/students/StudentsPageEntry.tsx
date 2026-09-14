"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { StudentsPageInitialList } from "./StudentsPageClient";

const StudentsPageClient = dynamic(() => import("./StudentsPageClient"), {
  loading: () => (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <div className="h-14 animate-pulse rounded-xl bg-white" />
        <div className="h-96 animate-pulse rounded-2xl bg-white" />
      </div>
    </div>
  ),
});

export default function StudentsPageEntry({
  navViewer = null,
  initialList = null,
}: {
  navViewer?: AppTopNavViewer | null;
  initialList?: StudentsPageInitialList | null;
}) {
  return <StudentsPageClient navViewer={navViewer} initialList={initialList} />;
}
