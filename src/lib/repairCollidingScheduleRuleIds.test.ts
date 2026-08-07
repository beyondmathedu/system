import { describe, expect, it } from "vitest";
import { repairCollidingScheduleRuleIds, scheduleRecordRowKey } from "@/lib/lessonScheduleVersions";

describe("repairCollidingScheduleRuleIds", () => {
  it("re-ids different slots that share the same legacy patch id", () => {
    const sharedId = "may26-tutor-00257-_|06_00_PM|M_-0501";
    const rules = [
      {
        id: sharedId,
        effectiveDate: "2026-05-01",
        weekday: "二",
        time: "06:00 PM",
        room: "M前",
        tutor: "Alex",
        createdAt: 1,
      },
      {
        id: sharedId,
        effectiveDate: "2026-05-01",
        weekday: "五",
        time: "06:00 PM",
        room: "M前",
        tutor: "Candy",
        createdAt: 2,
      },
    ];

    const { rules: repaired, repairedCount } = repairCollidingScheduleRuleIds(rules);

    expect(repairedCount).toBe(1);
    expect(repaired).toHaveLength(2);
    expect(new Set(repaired.map((r) => r.id)).size).toBe(2);
    expect(repaired.some((r) => r.weekday === "五" && r.id !== sharedId)).toBe(true);
    expect(new Set(repaired.map((r) => scheduleRecordRowKey(r))).size).toBe(2);
  });

  it("keeps unique ids unchanged", () => {
    const rules = [
      {
        id: "rule-a",
        effectiveDate: "2026-05-01",
        weekday: "一",
        time: "04:30 PM",
        room: "B",
        createdAt: 1,
      },
    ];
    const { rules: repaired, repairedCount } = repairCollidingScheduleRuleIds(rules);
    expect(repairedCount).toBe(0);
    expect(repaired).toEqual(rules);
  });
});
