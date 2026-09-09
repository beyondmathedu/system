import { describe, expect, it } from "vitest";
import { parseFeeMonthFromText } from "@/lib/zohoFeeMonthParse";

describe("parseFeeMonthFromText", () => {
  it("parses Chinese months including 10–12", () => {
    expect(parseFeeMonthFromText("F.5 8月 Math Course")).toBe(8);
    expect(parseFeeMonthFromText("學費 9月")).toBe(9);
    expect(parseFeeMonthFromText("10月課程")).toBe(10);
    expect(parseFeeMonthFromText("11月")).toBe(11);
    expect(parseFeeMonthFromText("12月 Math")).toBe(12);
  });

  it("parses English month names", () => {
    expect(parseFeeMonthFromText("F.5 Aug Sat")).toBe(8);
    expect(parseFeeMonthFromText("May tuition")).toBe(5);
    expect(parseFeeMonthFromText("September course")).toBe(9);
  });

  it("returns null when no month is present", () => {
    expect(parseFeeMonthFromText("F.5 Math Course")).toBeNull();
  });
});
