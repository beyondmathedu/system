"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { StudentsPageInitialList } from "./StudentsPageClient";

const StudentsPageClient = dynamic(() => import("./StudentsPageClient"), {
  loading: () => (
    <div className="min-h-screen bg-slate-100 px-3 py-10 sm:px-5 lg:px-6" aria-busy="true">
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <div className="h-12 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-16 animate-pulse rounded-xl bg-white" />
        <div className="h-80 animate-pulse rounded-xl bg-white" />
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
