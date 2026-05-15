/**
 * FIFO：已繳金額按 L1→L9（有日期嘅格）順序扣；每格可有唔同單價。
 */
export function buildFifoUnpaidLessonSummaryMulti(
  submitted: number,
  lessonDisplayDatesPerL: string[],
  slotPrices: number[],
): string {
  const slots: { label: string; price: number }[] = [];
  let pi = 0;
  for (let i = 0; i < lessonDisplayDatesPerL.length; i++) {
    const d = String(lessonDisplayDatesPerL[i] ?? "").trim();
    if (!d) continue;
    const price = Number(slotPrices[pi]) || 0;
    pi += 1;
    slots.push({ label: `L${i + 1}（${d}）`, price });
  }
  if (slots.length === 0) return "本月無 L 日期";
  if (slots.some((s) => s.price <= 0)) return "單價未齊";

  let pool = Math.max(0, Number(submitted) || 0);
  const unpaid: string[] = [];
  for (const s of slots) {
    const p = s.price;
    if (pool >= p) {
      pool -= p;
      continue;
    }
    if (pool > 0) {
      unpaid.push(`${s.label}·半`);
      pool = 0;
    } else {
      unpaid.push(s.label);
    }
  }
  if (unpaid.length === 0) return "已清";
  return unpaid.join("、");
}
