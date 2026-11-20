/** True for phone browsers; false for desktop and most iPads (incl. shared classroom iPad). */
export function isPhoneUserAgent(ua: string): boolean {
  return /Android.*Mobile|iPhone|iPod/i.test(String(ua ?? ""));
}
