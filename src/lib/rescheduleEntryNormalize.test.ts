import { describe, expect, it } from "vitest";
import {
  normalizeRescheduleEntriesForSchedule,
  upsertRescheduleEntry,
} from "@/lib/rescheduleEntryNormalize";
import type { YearLessonRecord, YearLessonRescheduleEntry } from "@/lib/yearScheduleCore";

const records: YearLessonRecord[] = [
  {
    id: "rule-1000",
    effectiveDate: "2026-07-01",
    weekday: "六",
    time: "10:00 AM",
    room: "B",
    createdAt: 1,
  },
  {
    id: "rule-1130",
    effectiveDate: "2026-07-01",
    weekday: "六",
    time: "11:30 AM",
    room: "B",
    createdAt: 2,
  },
];

describe("rescheduleEntryNormalize", () => {
  it("drops orphan legacy entries on multi-lesson dates", () => {
    const entries: YearLessonRescheduleEntry[] = [
      {
        id: "legacy",
        fromDate: "2026-07-04",
        toDate: "2026-08-04",
        time: "06:00 PM",
        room: "B",
      },
    ];
    const normalized = normalizeRescheduleEntriesForSchedule(entries, records, {}, {}, 2026);
    expect(normalized).toHaveLength(0);
  });

  it("upsert strips legacy whole-day entry when adding a slotted entry", () => {
    const entries: YearLessonRescheduleEntry[] = [
      {
        id: "legacy",
        fromDate: "2026-07-04",
        toDate: "2026-08-04",
        time: "06:00 PM",
        room: "B",
      },
    ];
    const next = upsertRescheduleEntry(
      entries,
      {
        id: "rs-1000",
        fromDate: "2026-07-04",
        toDate: "2026-08-04",
        time: "06:00 PM",
        room: "B",
        fromScheduleRuleId: "rule-1000",
        fromTime: "10:00 AM",
        fromRoom: "B",
      },
      2,
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("rs-1000");
  });
});
