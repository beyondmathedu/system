import { describe, expect, it } from "vitest";

function allocateReceiptPaidAmounts(
  receiptNet: number,
  rows: Array<{ month: number; lessonCount: number; gross: number }>,
): number[] {
  if (!rows.length) return [];
  const grossSum = rows.reduce((s, r) => s + r.gross, 0);
  const net = receiptNet > 0 ? receiptNet : grossSum;
  if (net <= 0) return rows.map(() => 0);
  if (grossSum <= 0) {
    if (rows.length === 1) return [Math.round(net * 100) / 100];
    const each = Math.round((net / rows.length) * 100) / 100;
    return rows.map(() => each);
  }
  return rows.map((r) => Math.round((r.gross / grossSum) * net * 100) / 100);
}

describe("allocateReceiptPaidAmounts", () => {
  it("uses receipt total when line gross exceeds net (discount)", () => {
    const paid = allocateReceiptPaidAmounts(820, [{ month: 7, lessonCount: 4, gross: 1120 }]);
    expect(paid).toEqual([820]);
  });

  it("keeps full gross when no receipt discount", () => {
    const paid = allocateReceiptPaidAmounts(1120, [{ month: 7, lessonCount: 4, gross: 1120 }]);
    expect(paid).toEqual([1120]);
  });

  it("returns zero paid amounts when receipt net is unknown (avoid pre-discount gross)", () => {
    const paid = allocateReceiptPaidAmounts(0, [{ month: 7, lessonCount: 4, gross: 1120 }]);
    expect(paid).toEqual([0]);
  });

  it("allocates math-only net after subtracting non-course gross", () => {
    const mathOnlyNet = Math.max(0, 920 - 100);
    const paid = allocateReceiptPaidAmounts(mathOnlyNet, [{ month: 7, lessonCount: 4, gross: 1120 }]);
    expect(paid).toEqual([820]);
  });
});

describe("isTuitionLineItem", () => {
  function lineItemDescriptionText(li: Record<string, unknown>): string {
    return [li.item_name, li.name, li.description]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .join(" ");
  }

  function isTuitionLineItem(li: Record<string, unknown>): boolean {
    const text = lineItemDescriptionText(li).toLowerCase();
    if (text.includes("math course")) return true;
    return /\bf\.?\s*[1-6]\b/.test(text);
  }

  it("matches F.5 Math Course lines", () => {
    expect(isTuitionLineItem({ name: "F.5 Math Course", description: "Jul Sat" })).toBe(true);
  });

  it("matches F.1–F.6 without Math Course wording", () => {
    expect(isTuitionLineItem({ name: "F.3", description: "Jun Tue" })).toBe(true);
    expect(isTuitionLineItem({ name: "F6 Math", description: "Aug Sat" })).toBe(true);
  });

  it("skips stationery", () => {
    expect(isTuitionLineItem({ name: "Notebook Set", description: "Stationery" })).toBe(false);
  });
});

describe("shouldFetchReceiptDetail", () => {
  function shouldFetchReceiptDetail(
    receiptId: string,
    lineItems: Array<Record<string, unknown>>,
    receiptNet: number,
    tuitionGross: number,
  ): boolean {
    if (!receiptId) return false;
    if (lineItems.length === 0 || receiptNet <= 0) return true;
    if (tuitionGross > 0 && receiptNet + 0.005 >= tuitionGross) return true;
    return false;
  }

  it("fetches detail when list header matches pre-discount gross", () => {
    expect(shouldFetchReceiptDetail("sr-1", [{ name: "x" }], 1120, 1120)).toBe(true);
  });

  it("skips detail when header already below gross (discount applied)", () => {
    expect(shouldFetchReceiptDetail("sr-1", [{ name: "x" }], 820, 1120)).toBe(false);
  });
});

describe("matchStudentIdFromReceipt (narrow)", () => {
  function normalizeName(s: string): string {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function matchNarrow(blob: string, students: Array<{ id: string; name_zh: string; nickname_en: string }>) {
    const normalized = normalizeName(blob);
    let found: string | null = null;
    for (const s of students) {
      const zh = normalizeName(s.name_zh);
      if (!zh || !normalized.includes(zh)) continue;
      const nick = normalizeName(s.nickname_en);
      if (nick && !normalized.includes(nick)) continue;
      if (found && found !== s.id) return null;
      found = s.id;
    }
    return found;
  }

  it("matches 王偉霖William without student id on receipt", () => {
    expect(
      matchNarrow("王偉霖william", [{ id: "00265", name_zh: "王偉霖", nickname_en: "William" }]),
    ).toBe("00265");
  });
});
