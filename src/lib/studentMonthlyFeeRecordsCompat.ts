/** student_monthly_fee_records：兼容未跑 split remarks migration 的库 */

export const FEE_RECORD_SELECT_PRICING =
  "student_id, year, month, lesson_unit_price, fee_pricing_grade";

export const FEE_RECORD_SELECT_BASE =
  "student_id, year, month, submitted_amount, lesson_unit_price, fee_pricing_grade, remarks, send_fee";

export const FEE_RECORD_SELECT_WITH_SPLIT_REMARKS =
  `${FEE_RECORD_SELECT_BASE}, makeup_remarks, balance_due_remarks`;

export function isMissingFeeRecordColumnError(message: string): boolean {
  return /could not find the .* column/i.test(message) || /column .* does not exist/i.test(message);
}

export function normalizeFeeRecordRow(row: Record<string, unknown>) {
  return {
    student_id: String(row.student_id ?? ""),
    year: Number(row.year ?? 0),
    month: Number(row.month ?? 0),
    submitted_amount: Number(row.submitted_amount ?? 0) || 0,
    lesson_unit_price:
      row.lesson_unit_price == null || Number.isNaN(Number(row.lesson_unit_price))
        ? null
        : Number(row.lesson_unit_price),
    fee_pricing_grade:
      row.fee_pricing_grade == null ? null : String(row.fee_pricing_grade),
    remarks: String(row.remarks ?? ""),
    makeup_remarks: String(row.makeup_remarks ?? ""),
    balance_due_remarks: String(row.balance_due_remarks ?? ""),
    send_fee: Boolean(row.send_fee),
  };
}
