"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type RoomScheduleTable from "./RoomScheduleTable";

const RoomScheduleTableDynamic = dynamic(() => import("./RoomScheduleTable"), {
  loading: () => (
    <div className="h-80 w-full animate-pulse rounded-xl bg-slate-100" aria-hidden />
  ),
});

type Props = ComponentProps<typeof RoomScheduleTable>;

export default function RoomScheduleTableLazy(props: Props) {
  return <RoomScheduleTableDynamic {...props} />;
}
