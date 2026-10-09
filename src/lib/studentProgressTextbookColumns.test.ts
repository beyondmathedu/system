import { describe, expect, it } from "vitest";
import {
  buildProgressSheetColumns,
  findTextbookColumnPairs,
  parseTextbookHeaderLabel,
  selectTextbookColumnPair,
  textbookOptionsForProgressSheet,
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

describe("selectTextbookColumnPair for M1/M2 workbook headers", () => {
  const m1Pairs = findTextbookColumnPairs([
    "",
    "Textbook:",
    "Textbook:",
    "Basic Concept",
    "Date",
    "Remarks",
    "Textbook: Senior Secondary Oxford Math for the New Century",
    "Textbook: Senior Secondary Oxford Math for the New Century",
    "Textbook: HKDSE Mathematics in Action (Extended Part)",
    "Textbook: HKDSE Mathematics in Action (Extended Part)",
    "Textbook:Mathematics in Focus",
    "Textbook:Mathematics in Focus",
    "Textbook: New Progress in Senior Mathematics",
    "Textbook: New Progress in Senior Mathematics",
  ]);

  it("maps Oxford New Century to the Oxford M1 columns", () => {
    const selected = selectTextbookColumnPair(m1Pairs, "Oxford · New Century", "F.4");
    expect(selected?.label).toBe("Senior Secondary Oxford Math for the New Century");
  });

  it("maps Pearson senior Maths in Action to the Extended Part columns", () => {
    const selected = selectTextbookColumnPair(
      m1Pairs,
      "Pearson · Mathematics in Action (3rd)",
      "F.5",
    );
    expect(selected?.label).toBe("HKDSE Mathematics in Action (Extended Part)");
  });

  it("maps Ephhk Mathematics in Focus to the Focus columns", () => {
    const selected = selectTextbookColumnPair(
      m1Pairs,
      "Ephhk · Mathematics in Focus (2nd)",
      "F.5",
    );
    expect(selected?.label).toBe("Mathematics in Focus");
  });

  it("uses the dedicated M1 textbook selection on the extended catalog", () => {
    const selected = selectTextbookColumnPair(
      m1Pairs,
      "Oxford · Senior Secondary Oxford Math for the New Century",
      "F.5",
      "extended",
    );
    expect(selected?.label).toBe("Senior Secondary Oxford Math for the New Century");
  });

  it("uses Pearson Extended Part from the M1 textbook field", () => {
    const selected = selectTextbookColumnPair(
      m1Pairs,
      "Pearson · HKDSE Mathematics in Action (Extended Part)",
      "F.5",
      "extended",
    );
    expect(selected?.label).toBe("HKDSE Mathematics in Action (Extended Part)");
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
    const basicIdx = cols.findIndex(
      (c) => c.kind === "normal" && c.header === "Basic Concept",
    );
    const textbookIdx = cols.findIndex((c) => c.kind === "textbookCombined");
    expect(textbookIdx).toBeLessThan(basicIdx);
  });

  it("places M1 textbook left of Basic Concept with publisher in the label", () => {
    const headers = [
      "",
      "Textbook:",
      "Textbook:",
      "Basic Concept",
      "Date",
      "Remarks",
      "Textbook: Senior Secondary Oxford Math for the New Century",
      "Textbook: Senior Secondary Oxford Math for the New Century",
      "Textbook: HKDSE Mathematics in Action (Extended Part)",
      "Textbook: HKDSE Mathematics in Action (Extended Part)",
    ];
    const cols = buildProgressSheetColumns(
      headers,
      textbookOptionsForProgressSheet("M1", {
        textbookPublisher: "Pearson · Maths in Action",
        grade: "F.4",
        m1TextbookPublisher: "Oxford · Senior Secondary Oxford Math for the New Century",
      }),
    );
    const textbookIdx = cols.findIndex((c) => c.kind === "textbookCombined");
    const basicIdx = cols.findIndex(
      (c) => c.kind === "normal" && c.header === "Basic Concept",
    );
    expect(textbookIdx).toBeGreaterThanOrEqual(0);
    expect(basicIdx).toBeGreaterThan(textbookIdx);
    const textbook = cols[textbookIdx];
    expect(textbook && textbook.kind === "textbookCombined" ? textbook.colIndexEn : -1).toBe(6);
    expect(textbook && textbook.kind === "textbookCombined" ? textbook.displayLabel : "").toBe(
      "Senior Secondary Oxford Math for the New Century (Oxford)",
    );
  });
});
