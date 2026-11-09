import { describe, expect, it } from "vitest";
import {
  SCHEDULE_CACHE_TAG_AGGREGATES,
  SCHEDULE_CACHE_TAG_CLASSROOMS,
  SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
  SCHEDULE_CACHE_TAG_FEE_RECORD,
  SCHEDULE_CACHE_TAG_HOME,
  SCHEDULE_CACHE_TAG_STUDENT_PROGRESS,
  resolveScheduleCacheTags,
} from "./scheduleCacheTags";

describe("resolveScheduleCacheTags", () => {
  it("defaults to all tags when scope is omitted", () => {
    const tags = resolveScheduleCacheTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        SCHEDULE_CACHE_TAG_AGGREGATES,
        SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
        SCHEDULE_CACHE_TAG_HOME,
        SCHEDULE_CACHE_TAG_STUDENT_PROGRESS,
        SCHEDULE_CACHE_TAG_CLASSROOMS,
        SCHEDULE_CACHE_TAG_FEE_RECORD,
      ]),
    );
    expect(tags).toHaveLength(6);
  });

  it("keeps schedule scope off fee and progress tags", () => {
    const tags = resolveScheduleCacheTags("schedule");
    expect(tags).toEqual([
      SCHEDULE_CACHE_TAG_AGGREGATES,
      SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
      SCHEDULE_CACHE_TAG_HOME,
    ]);
    expect(tags).not.toContain(SCHEDULE_CACHE_TAG_FEE_RECORD);
    expect(tags).not.toContain(SCHEDULE_CACHE_TAG_STUDENT_PROGRESS);
  });

  it("scopes fee invalidation to fee + day timetable", () => {
    expect(resolveScheduleCacheTags("fee")).toEqual([
      SCHEDULE_CACHE_TAG_FEE_RECORD,
      SCHEDULE_CACHE_TAG_DAY_TIMETABLE,
    ]);
  });
});
