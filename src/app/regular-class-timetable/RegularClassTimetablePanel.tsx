"use client";

import { useMemo, useState } from "react";
import DayTimetableLegend from "@/components/DayTimetableLegend";
import DayTimetableStyleEditorLazy from "@/components/DayTimetableStyleEditorLazy";
import DayTimetableTable from "@/components/DayTimetableTable";
import {
  ALL_REGULAR_TIMETABLE_FILTER,
  DEFAULT_REGULAR_TIMETABLE_FILTER,
  filterDayTimetablePayloadByLessonView,
  regularTimetableEmptyMessage,
  type DayTimetablePayload,
  type RegularTimetableLessonFilterFlags,
} from "@/lib/dayTimetableShared";

const FILTER_TICKS: Array<{ key: keyof RegularTimetableLessonFilterFlags; label: string }> = [
  { key: "regular", label: "Regular" },
  { key: "extra", label: "Extra" },
  { key: "reschedule", label: "Reschedule" },
  { key: "inactive", label: "Inactive" },
  { key: "cancelled", label: "Cancelled" },
];

type Props = {
  payload: DayTimetablePayload;
};

export default function RegularClassTimetablePanel({ payload }: Props) {
  const [flags, setFlags] = useState<RegularTimetableLessonFilterFlags>(DEFAULT_REGULAR_TIMETABLE_FILTER);

  const tablePayload = useMemo(
    () => filterDayTimetablePayloadByLessonView(payload, flags),
    [payload, flags],
  );

  const filterKey = FILTER_TICKS.map(({ key }) => (flags[key] ? "1" : "0")).join("");
  const allSelected = FILTER_TICKS.every(({ key }) => flags[key]);

  function toggle(key: keyof RegularTimetableLessonFilterFlags) {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function selectAll() {
    setFlags({ ...ALL_REGULAR_TIMETABLE_FILTER });
  }

  function selectRegularOnly() {
    setFlags({ ...DEFAULT_REGULAR_TIMETABLE_FILTER });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-bold text-slate-700">Regular lessons (selected day)</div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
          <span className="shrink-0 text-[11px] font-semibold text-slate-600">Show</span>
          {FILTER_TICKS.map(({ key, label }) => (
            <label
              key={key}
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-700"
            >
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={() => toggle(key)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-[#1d76c2] focus:ring-[#1d76c2]/40"
              />
              {label}
            </label>
          ))}
          <span className="flex items-center gap-2 border-l border-slate-200 pl-3 text-[11px]">
            <button
              type="button"
              onClick={selectAll}
              disabled={allSelected}
              className="font-semibold text-[#1d76c2] underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline"
            >
              All
            </button>
            <button
              type="button"
              onClick={selectRegularOnly}
              className="font-semibold text-slate-600 underline hover:text-slate-800"
            >
              Regular only
            </button>
          </span>
        </div>
      </div>
      <DayTimetableTable
        key={`${payload.dateIso}:${filterKey}`}
        payload={tablePayload}
        emptyMessage={regularTimetableEmptyMessage(flags)}
        showRegularCapacitySummary
        compactStudentNames
      />
      <DayTimetableLegend timetableStyle={payload.timetableStyle} showCapacityLegend />
      <div className="mt-6">
        <DayTimetableStyleEditorLazy initial={payload.timetableStyle} />
      </div>
    </>
  );
}
