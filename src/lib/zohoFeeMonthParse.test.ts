import { describe, expect, it } from "vitest";
import {
  parseFeeMonthFromText,
  resolveFeeMonthFromZohoLine,
  zohoLineItemDescriptionText,
} from "@/lib/zohoFeeMonthParse";

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
    expect(parseFeeMonthFromText("Jul 31")).toBe(7);
    expect(parseFeeMonthFromText("Aug Fri")).toBe(8);
    expect(parseFeeMonthFromText("May tuition")).toBe(5);
    expect(parseFeeMonthFromText("September course")).toBe(9);
  });

  it("parses Zoho Item Description date lists like Sep 21,28", () => {
    expect(parseFeeMonthFromText("Sep 21,28")).toBe(9);
    expect(
      parseFeeMonthFromText(
        zohoLineItemDescriptionText({
          name: "F.6 Math Course",
          description: "Sep 21,28",
        }),
      ),
    ).toBe(9);
  });

  it("returns null when no month is present", () => {
    expect(parseFeeMonthFromText("F.5 Math Course")).toBeNull();
  });
});

describe("resolveFeeMonthFromZohoLine", () => {
  it("prefers Item & Description over receipt date", () => {
    expect(
      resolveFeeMonthFromZohoLine({
        lineItem: { name: "F.6 Math Course", description: "Sep 21,28" },
        receiptDateMonth: 8,
      }),
    ).toBe(9);
  });

  it("splits Jul/Aug lines on a July-dated receipt (SR-01239 style)", () => {
    expect(
      resolveFeeMonthFromZohoLine({
        lineItem: { name: "F.4 Math Course", description: "Jul 31" },
        receiptDateMonth: 7,
      }),
    ).toBe(7);
    expect(
      resolveFeeMonthFromZohoLine({
        lineItem: { name: "F.4 Math Course", description: "Aug Fri" },
        receiptDateMonth: 7,
      }),
    ).toBe(8);
  });

  it("falls back to receipt date when Item & Description has no month", () => {
    expect(
      resolveFeeMonthFromZohoLine({
        lineItem: { name: "F.6 Math Course", description: "" },
        receiptDateMonth: 8,
      }),
    ).toBe(8);
  });
});
