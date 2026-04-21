export function normalizeGradeCode(input: string | null | undefined): string {
  const text = (input ?? "").trim();
  if (!text) return "";
  const compact = text.replace(/\s+/g, "").toUpperCase();
  const match = /^F\.?([1-6])$/.exec(compact);
  if (match) return `F${match[1]}`;
  return text;
}

export function formatGradeDisplay(input: string | null | undefined): string {
  const code = normalizeGradeCode(input);
  const match = /^F([1-6])$/.exec(code);
  if (match) return `F.${match[1]}`;
  return code;
}

export function gradeRank(input: string | null | undefined): number {
  const code = normalizeGradeCode(input);
  const match = /^F([1-6])$/.exec(code);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
}

export function isF6Grade(input: string | null | undefined): boolean {
  return normalizeGradeCode(input) === "F6";
}
