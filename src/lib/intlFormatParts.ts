/**
 * formatToParts 單次掃描（避免對同一 parts 陣列重複 .find）
 */
export function readYmdParts(
  parts: Intl.DateTimeFormatPart[],
  defaults: { y: string; m: string; d: string } = { y: "0000", m: "01", d: "01" },
): { y: string; m: string; d: string } {
  let y = defaults.y;
  let m = defaults.m;
  let d = defaults.d;
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
    else if (p.type === "day") d = p.value;
  }
  return { y, m, d };
}

export function readYmParts(
  parts: Intl.DateTimeFormatPart[],
  defaults: { y: string; m: string } = { y: "2026", m: "01" },
): { y: string; m: string } {
  let y = defaults.y;
  let mo = defaults.m;
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") mo = p.value;
  }
  return { y, m: mo };
}

export function readMonthPart(parts: Intl.DateTimeFormatPart[], defaultMonth = "1"): string {
  for (const p of parts) {
    if (p.type === "month") return p.value;
  }
  return defaultMonth;
}
