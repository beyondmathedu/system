/** Parse tuition month from Zoho line / receipt text (EN month name or 中文 N月). */
const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Prefer 10–12 before 1–9 so "10月" is October, not January + stray "0月".
 */
export function parseFeeMonthFromText(text: string): number | null {
  const t = String(text ?? "").toLowerCase();
  const zh = /(1[0-2]|[1-9])\s*月/.exec(t);
  if (zh) return Number(zh[1]);
  const en =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.exec(
      text,
    );
  if (!en) return null;
  return MONTH_MAP[en[1].toLowerCase()] ?? null;
}
