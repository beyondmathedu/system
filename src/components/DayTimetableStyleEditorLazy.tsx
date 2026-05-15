"use client";

import dynamic from "next/dynamic";
import type { DayTimetableStyleSettings } from "@/lib/dayTimetableStyleSettings";
import type { DayTimetableUiLocale } from "@/lib/dayTimetableUiStrings";

const DayTimetableStyleEditor = dynamic(() => import("@/components/DayTimetableStyleEditor"), {
  ssr: false,
  loading: () => <div className="mt-6 h-28 animate-pulse rounded-xl bg-slate-100" aria-hidden />,
});

type Props = {
  initial: DayTimetableStyleSettings;
  uiLocale?: DayTimetableUiLocale;
};

export default function DayTimetableStyleEditorLazy(props: Props) {
  return <DayTimetableStyleEditor {...props} />;
}
