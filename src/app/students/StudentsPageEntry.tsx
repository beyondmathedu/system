"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { StudentsPageInitialList } from "./StudentsPageClient";

function StudentsPageSkeleton() {
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

const StudentsPageClient = dynamic(() => import("./StudentsPageClient"), {
  ssr: false,
  loading: StudentsPageSkeleton,
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
