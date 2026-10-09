import { describe, expect, it } from "vitest";
import {
  buildPuEntryDateKey,
  buildPuEntryNoteKey,
  listPuEntriesFromSelections,
  mergePreservingPuSelections,
  patchPuEntryField,
  visiblePuEntryCount,
} from "@/lib/studentProgressPuNotes";

describe("studentProgressPuNotes", () => {
  it("builds stable selection keys", () => {
    expect(buildPuEntryDateKey(0)).toBe("PU::entry::0::date");
    expect(buildPuEntryNoteKey(2)).toBe("PU::entry::2::note");
  });

  it("lists sparse entries with gaps filled", () => {
    const entries = listPuEntriesFromSelections({
      [buildPuEntryDateKey(0)]: "2026-01-01",
      [buildPuEntryNoteKey(2)]: "later note",
    });
    expect(entries).toEqual([
      { date: "2026-01-01", note: "" },
      { date: "", note: "" },
      { date: "", note: "later note" },
    ]);
  });

  it("keeps trailing blank rows like a spreadsheet", () => {
    expect(visiblePuEntryCount({})).toBe(8);
    expect(
      visiblePuEntryCount({
        [buildPuEntryDateKey(0)]: "2026-01-01",
        [buildPuEntryNoteKey(6)]: "row 7",
      }),
    ).toBe(8);
    expect(
      visiblePuEntryCount({
        [buildPuEntryNoteKey(9)]: "row 10",
      }),
    ).toBe(11);
  });

  it("patches and clears fields", () => {
    const withDate = patchPuEntryField({}, 1, "date", "2026-03-04");
    expect(withDate[buildPuEntryDateKey(1)]).toBe("2026-03-04");
    const cleared = patchPuEntryField(withDate, 1, "date", "  ");
    expect(cleared[buildPuEntryDateKey(1)]).toBeUndefined();
  });

  it("preserves existing PU keys when merging non-admin saves", () => {
    const merged = mergePreservingPuSelections(
      {
        "F5::0::1": "Good",
        [buildPuEntryNoteKey(0)]: "hacked",
      },
      {
        [buildPuEntryDateKey(0)]: "2026-01-01",
        [buildPuEntryNoteKey(0)]: "admin note",
      },
    );
    expect(merged).toEqual({
      "F5::0::1": "Good",
      [buildPuEntryDateKey(0)]: "2026-01-01",
      [buildPuEntryNoteKey(0)]: "admin note",
    });
  });
});
