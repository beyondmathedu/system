export function isLegacyBmStudentId(id: string): boolean {
  return /^BM\d+$/i.test(String(id ?? "").trim());
}

/**
 * New canonical student id is 5-digit numeric string: "00147"
 * Legacy id was "BM147". We normalize for routing/backward compatibility.
 */
export function normalizeStudentId(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  if (isLegacyBmStudentId(raw)) {
    const digits = raw.replace(/^BM/i, "");
    const n = Number(digits);
    if (!Number.isFinite(n) || n <= 0) return raw;
    return String(Math.trunc(n)).padStart(5, "0");
  }

  // If already numeric-ish, pad to 5 digits when possible.
  if (/^\d{1,5}$/.test(raw)) return raw.padStart(5, "0");
  if (/^\d{6,}$/.test(raw)) return raw; // leave longer ids as-is
  return raw;
}

/** Numeric key for fee-tier cutover; null if id is not all digits. */
export function studentIdNumericSortKey(input: string): number | null {
  const id = normalizeStudentId(input);
  if (!/^\d+$/.test(id)) return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

/** Parse comma / space / newline separated student ids into normalized unique ids. */
export function parseStudentIdList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? "").split(/[\s,;]+/)) {
    const id = normalizeStudentId(part.trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Canonical one-id-per-line text for storage and UI. */
export function normalizeStudentIdList(raw: string): string {
  const ids = parseStudentIdList(raw);
  ids.sort((a, b) => {
    const ka = studentIdNumericSortKey(a);
    const kb = studentIdNumericSortKey(b);
    if (ka != null && kb != null && ka !== kb) return ka - kb;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  return ids.join("\n");
}

/** True when student id is listed for current (new) fee tiers before global switch. */
export function studentIdInCurrentPriceList(studentId: string, listRaw: string): boolean {
  const id = normalizeStudentId(studentId).trim();
  if (!id) return false;
  return parseStudentIdList(listRaw).includes(id);
}

