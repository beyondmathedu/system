"use client";

import dynamic from "next/dynamic";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import type { StudentProgressInitialPayload } from "./StudentProgressByIdClient";

const StudentProgressByIdClient = dynamic(() => import("./StudentProgressByIdClient"), {
  loading: () => (
    <div className="min-h-screen bg-slate-100 px-3 py-10 sm:px-5 lg:px-6" aria-busy="true">
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <div className="h-12 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-24 animate-pulse rounded-xl bg-white" />
        <div className="h-96 animate-pulse rounded-xl bg-white" />
      </div>
    </div>
  ),
});

export default function StudentProgressByIdEntry(props: {
  navViewer: AppTopNavViewer | null;
  readOnly: boolean;
  initial: StudentProgressInitialPayload | null;
}) {
  return <StudentProgressByIdClient {...props} />;
}
