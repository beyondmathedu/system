export type F6ByTopicsChapter = {
  en: string;
  zh: string;
};

type SheetLike = {
  name: string;
  headers: string[];
  rows: string[][];
};

/** Canonical Chapter column for F6 / F6 By Topics (EN + ZH). */
export const F6_BY_TOPICS_CHAPTERS: readonly F6ByTopicsChapter[] = [
  { en: "Factorization,Basic Equation Solving", zh: "因式分解，基本解方程" },
  { en: "Percentage", zh: "百分比" },
  { en: "Rate and Ratio", zh: "率與比" },
  { en: "Number System, Complex Number, Appro.& Error", zh: "數系進制,複數,估算與誤差" },
  { en: "Inequality", zh: "不等式" },
  { en: "Mensuration", zh: "求積法" },
  { en: "Variations", zh: "變分" },
  { en: "More about Polynomials", zh: "續多項式" },
  { en: "Properties of Circle", zh: "圓的性質" },
  { en: "Statistics", zh: "統計學" },
  { en: "Geometry", zh: "幾何" },
  { en: "Exponendral and Logarithmise", zh: "指數及對數函數" },
  { en: "Permutation, Combination, Probability", zh: "排列，組合，概率" },
  { en: "Coordinate Geometry", zh: "座標幾何" },
  { en: "Quadratic Equations", zh: "一元二次方程" },
  { en: "Graphs of Functions", zh: "函數圖像" },
  { en: "Linear Programming", zh: "線性規劃" },
  { en: "Arithmetic,Geometric Sequence", zh: "等差/等比序列" },
  { en: "3D Trigonometry", zh: "3D 三角學" },
  { en: "Trigonometry", zh: "三角學" },
  { en: "(Equation Straight Line)", zh: "(直線方程)" },
] as const;

function normalizeHeaderName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .trim();
}

function isTextbookHeader(header: string): boolean {
  const norm = normalizeHeaderName(header);
  if (norm === "textbook" || norm === "textbook:") return true;
  return /^textbook\s*:/.test(norm);
}

function findTextbookColumnPairs(headers: string[]): Array<{ colIndexEn: number; colIndexZh: number }> {
  const pairs: Array<{ colIndexEn: number; colIndexZh: number }> = [];
  for (let i = 0; i < headers.length; i += 1) {
    const cur = headers[i] ?? "";
    const next = headers[i + 1] ?? "";
    if (!isTextbookHeader(cur) || !isTextbookHeader(next)) continue;
    pairs.push({ colIndexEn: i, colIndexZh: i + 1 });
    i += 1;
  }
  return pairs;
}

function isLegendDataRow(row: string[]): boolean {
  const key = String(row[0] ?? "")
    .trim()
    .toLowerCase();
  return key === "remedial" || key === "good" || key === "mastered";
}

export function isF6ByTopicsChapterSheet(sheetName: string): boolean {
  return sheetName === "F6 By Topics";
}

/** Replace workbook topic rows with the canonical Chapter list; keep legend rows. */
export function applyF6ByTopicsChapters<T extends SheetLike>(sheet: T): T {
  if (!isF6ByTopicsChapterSheet(sheet.name)) return sheet;

  const pairs = findTextbookColumnPairs(sheet.headers);
  if (!pairs.length) return sheet;

  const legendRows = sheet.rows.filter((row) => isLegendDataRow(row)).map((row) => [...row]);
  const width = Math.max(sheet.headers.length, ...sheet.rows.map((r) => r.length), 1);

  const chapterRows = F6_BY_TOPICS_CHAPTERS.map((chapter, index) => {
    const row = Array.from({ length: width }, () => "");
    if (index === 0) row[0] = "F.6";
    for (const pair of pairs) {
      row[pair.colIndexEn] = chapter.en;
      row[pair.colIndexZh] = chapter.zh;
    }
    return row;
  });

  return {
    ...sheet,
    rows: [...chapterRows, ...legendRows],
  };
}
