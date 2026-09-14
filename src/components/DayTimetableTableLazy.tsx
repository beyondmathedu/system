"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type DayTimetableTable from "@/components/DayTimetableTable";

const DayTimetableTableDynamic = dynamic(() => import("@/components/DayTimetableTable"), {
  loading: () => (
    <div className="h-64 w-full animate-pulse rounded-xl bg-slate-100" aria-hidden />
  ),
});

type Props = ComponentProps<typeof DayTimetableTable>;

export default function DayTimetableTableLazy(props: Props) {
  return <DayTimetableTableDynamic {...props} />;
}
