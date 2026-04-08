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

