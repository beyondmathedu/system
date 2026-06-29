"use client";

import dynamic from "next/dynamic";
import type { DayTimetableStyleSettings } from "@/lib/dayTimetableStyleSettings";
const DayTimetableStyleEditor = dynamic(() => import("@/components/DayTimetableStyleEditor"), {
  ssr: false,
  loading: () => <div className="mt-6 h-28 animate-pulse rounded-xl bg-slate-100" aria-hidden />,
});

type Props = {
  initial: DayTimetableStyleSettings;
};

export default function DayTimetableStyleEditorLazy(props: Props) {
  return <DayTimetableStyleEditor {...props} />;
}
