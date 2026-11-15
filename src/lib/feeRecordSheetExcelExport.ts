/**
 * Client-side Excel export for /students-lesson-time-fee-record Record Sheet.
 */

export type FeeRecordSheetExcelRow = {
  id: string;
  name: string;
  grade: string;
  phone: string;
  weekday: string;
  tuitionPaid: number;
  balanceDue: number;
  lessonDates: string[];
  makeup: number;
  totalDue: number;
  prevDue: number;
  thisMonthExpected: number;
  openingBalance?: number;
  remarks: string;
};

function sanitizeFilenamePart(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_");
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function downloadFeeRecordSheetExcel(params: {
  sheetYear: number;
  sheetMonth: number;
  monthShort: string;
  lColumnCount: number;
  includeOpeningBalance: boolean;
  rows: FeeRecordSheetExcelRow[];
}): Promise<void> {
  const XLSX = await import("xlsx");
  const {
    sheetYear,
    sheetMonth,
    monthShort,
    lColumnCount,
    includeOpeningBalance,
    rows,
  } = params;

  const lHeaders = Array.from({ length: lColumnCount }, (_, i) => `L${i + 1}`);
  const headers: string[] = [
    "ID",
    "Name",
    "Grade",
    "Phone Number",
    "Weekday",
    "Tuition Paid",
    "Balance Due",
    ...lHeaders,
    "Makeup",
    "Total Due",
    "Prev Due",
    "This Month Expected",
    ...(includeOpeningBalance ? ["Opening balance"] : []),
    "Remarks",
  ];

  const aoa: (string | number)[][] = [headers];
  for (const row of rows) {
    const line: (string | number)[] = [
      row.id,
      row.name || "—",
      row.grade || "—",
      row.phone || "—",
      row.weekday || "—",
      roundMoney(row.tuitionPaid),
      roundMoney(row.balanceDue),
    ];
    for (let i = 0; i < lColumnCount; i += 1) {
      line.push(row.lessonDates[i] ?? "");
    }
    line.push(
      Number(row.makeup) || 0,
      roundMoney(row.totalDue),
      roundMoney(row.prevDue),
      roundMoney(row.thisMonthExpected),
    );
    if (includeOpeningBalance) {
      line.push(roundMoney(row.openingBalance ?? 0));
    }
    line.push(row.remarks ?? "");
    aoa.push(line);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // Keep L-column dates like "8/5" / "12/6→2/7" as text so Excel does not auto-convert.
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const lStartCol = 7; // after Balance Due
  const lEndCol = lStartCol + lColumnCount - 1;
  for (let R = range.s.r + 1; R <= range.e.r; R += 1) {
    for (let C = lStartCol; C <= lEndCol; C += 1) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[addr];
      if (cell && cell.v != null && cell.v !== "") {
        cell.t = "s";
        cell.v = String(cell.v);
        delete cell.w;
        delete cell.z;
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Record Sheet");
  const ym = `${sheetYear}-${String(sheetMonth).padStart(2, "0")}`;
  const filename = sanitizeFilenamePart(`fee_record_sheet_${ym}_${monthShort}`) + ".xlsx";
  XLSX.writeFile(wb, filename);
}
