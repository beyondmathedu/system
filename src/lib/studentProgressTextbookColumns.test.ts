import { describe, expect, it } from "vitest";
import {
  buildProgressSheetColumns,
  findTextbookColumnPairs,
  parseTextbookHeaderLabel,
  selectTextbookColumnPair,
} from "@/lib/studentProgressTextbookColumns";

describe("parseTextbookHeaderLabel", () => {
  it("returns null for generic Textbook headers", () => {
    expect(parseTextbookHeaderLabel("Textbook:")).toBeNull();
    expect(parseTextbookHeaderLabel("Textbook: ")).toBeNull();
  });

  it("extracts book title from labeled headers", () => {
    expect(parseTextbookHeaderLabel("Textbook: New Century")).toBe("New Century");
    expect(parseTextbookHeaderLabel("Textbook: Oxford · New Century")).toBe("Oxford · New Century");
  });
});

describe("findTextbookColumnPairs", () => {
  it("finds consecutive textbook EN/ZH pairs", () => {
    const headers = ["", "Textbook:", "Textbook:", "Basic Concept"];
    expect(findTextbookColumnPairs(headers)).toEqual([
      {
        headerEn: "Textbook:",
        headerZh: "Textbook:",
        colIndexEn: 1,
        colIndexZh: 2,
        label: null,
      },
    ]);
  });

  it("finds multiple publisher-specific pairs", () => {
    const headers = [
      "",
      "Textbook: New Century",
      "Textbook: New Century",
      "Textbook: Maths in Action",
      "Textbook: Maths in Action",
      "Basic Concept",
    ];
    const pairs = findTextbookColumnPairs(headers);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.label).toBe("New Century");
    expect(pairs[1]?.label).toBe("Maths in Action");
  });
});

describe("selectTextbookColumnPair", () => {
  const pairs = findTextbookColumnPairs([
    "",
    "Textbook: New Century",
    "Textbook: New Century",
    "Textbook: Maths in Action",
    "Textbook: Maths in Action",
    "Basic Concept",
  ]);

  it("selects Oxford · New Century for matching student", () => {
    const selected = selectTextbookColumnPair(pairs, "Oxford · New Century", "F.2");
    expect(selected?.label).toBe("New Century");
  });

  it("selects Pearson book for matching student", () => {
    const selected = selectTextbookColumnPair(pairs, "Pearson · Maths in Action", "F.2");
    expect(selected?.label).toBe("Maths in Action");
  });
});

describe("buildProgressSheetColumns", () => {
  it("keeps only the selected textbook pair in output columns", () => {
    const headers = [
      "",
      "Textbook: New Century",
      "Textbook: New Century",
      "Textbook: Maths in Action",
      "Textbook: Maths in Action",
      "Basic Concept",
    ];
    const cols = buildProgressSheetColumns(headers, {
      textbookPublisher: "Pearson · Maths in Action",
      grade: "F.2",
    });
    expect(cols.filter((c) => c.kind === "textbookCombined")).toHaveLength(1);
    const textbook = cols.find((c) => c.kind === "textbookCombined");
    expect(textbook && textbook.kind === "textbookCombined" ? textbook.colIndexEn : -1).toBe(3);
    expect(textbook && textbook.kind === "textbookCombined" ? textbook.displayLabel : "").toBe(
      "Maths in Action",
    );
  });
});
