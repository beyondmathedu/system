"use client";

import { useMemo, useState } from "react";
import DayTimetableLegend from "@/components/DayTimetableLegend";
import DayTimetableStyleEditorLazy from "@/components/DayTimetableStyleEditorLazy";
import DayTimetableTable from "@/components/DayTimetableTable";
import {
  filterDayTimetablePayloadByLessonView,
  type DayTimetablePayload,
  type RegularTimetableLessonView,
} from "@/lib/dayTimetableShared";

const VIEW_OPTIONS: Array<{ value: RegularTimetableLessonView; label: string }> = [
  { value: "regular", label: "Regular only" },
  { value: "all", label: "All lessons (Regular + Extra + Reschedule + Inactive)" },
  { value: "extra", label: "Extra (Regular + Extra)" },
  { value: "reschedule", label: "Reschedule (Regular + Reschedule)" },
  { value: "inactive", label: "Inactive (Regular + Inactive)" },
];

const EMPTY_BY_VIEW: Record<RegularTimetableLessonView, string> = {
  regular: "No regular lessons on this day.",
  all: "No lessons on this day.",
  extra: "No regular or extra lessons on this day.",
  reschedule: "No regular or reschedule lessons on this day.",
  inactive: "No regular or inactive (paused) lessons on this day.",
};

type Props = {
  payload: DayTimetablePayload;
};

export default function RegularClassTimetablePanel({ payload }: Props) {
  const [view, setView] = useState<RegularTimetableLessonView>("regular");

  const tablePayload = useMemo(
    () => filterDayTimetablePayloadByLessonView(payload, view),
    [payload, view],
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-bold text-slate-700">Regular lessons (selected day)</div>
        <label className="flex min-w-[200px] flex-1 items-center justify-end gap-2 sm:max-w-xs">
          <span className="shrink-0 text-[11px] font-semibold text-slate-600">Show</span>
          <select
            value={view}
            onChange={(e) => setView(e.target.value as RegularTimetableLessonView)}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
            aria-label="Lesson type to show"
          >
            {VIEW_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <DayTimetableTable
        key={`${payload.dateIso}:${view}`}
        payload={tablePayload}
        emptyMessage={EMPTY_BY_VIEW[view]}
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
