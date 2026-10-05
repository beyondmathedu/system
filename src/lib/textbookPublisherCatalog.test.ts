import { describe, expect, it } from "vitest";
import {
  formatTextbookPublisherValue,
  getExtendedMathsCatalog,
  resolveExtendedMathsTextbookSelection,
} from "@/lib/textbookPublisherCatalog";

describe("extended Maths M1/M2 catalog", () => {
  it("includes the four workbook publishers", () => {
    expect(getExtendedMathsCatalog().map((g) => g.publisher)).toEqual([
      "Oxford",
      "Pearson",
      "Ephhk",
      "HKEP",
    ]);
  });

  it("resolves stored M1/M2 textbook values", () => {
    const oxford = getExtendedMathsCatalog()[0]!.books[0]!;
    const stored = formatTextbookPublisherValue("Oxford", oxford);
    const resolved = resolveExtendedMathsTextbookSelection(stored);
    expect(resolved.publisher).toBe("Oxford");
    expect(resolved.book?.title).toBe("Senior Secondary Oxford Math for the New Century");
  });
});
