export type TextbookBand = "junior" | "senior";

export type TextbookBook = {
  title: string;
};

export type TextbookPublisherGroup = {
  publisher: string;
  books: TextbookBook[];
};

const JUNIOR_CATALOG: TextbookPublisherGroup[] = [
  {
    publisher: "Chung Tai",
    books: [{ title: "New Effective Learning" }],
  },
  {
    publisher: "Ephhk",
    books: [{ title: "Mathematics in Focus (2nd)" }, { title: "Maths Smart" }],
  },
  {
    publisher: "HKEP",
    books: [{ title: "Inspiring Journey" }],
  },
  {
    publisher: "Modern",
    books: [{ title: "Modern Secondary Mathematics" }],
  },
  {
    publisher: "Oxford",
    books: [{ title: "New Century" }],
  },
  {
    publisher: "Pearson",
    books: [{ title: "Maths in Action" }],
  },
];

const SENIOR_CATALOG: TextbookPublisherGroup[] = [
  {
    publisher: "Ephhk",
    books: [{ title: "Maths Smart" }, { title: "Mathematics in Focus (2nd)" }],
  },
  {
    publisher: "HKEP",
    books: [{ title: "Maths Beyond" }],
  },
  {
    publisher: "Modern",
    books: [{ title: "Modern Secondary Mathematics" }],
  },
  {
    publisher: "Oxford",
    books: [{ title: "New Century" }],
  },
  {
    publisher: "Pearson",
    books: [
      { title: "Mastering Mathematics (2nd Edition)" },
      { title: "Mathematics in Action (3rd)" },
    ],
  },
  {
    publisher: "Aristo",
    books: [{ title: "Maths Insight" }],
  },
];

/** Legacy stored values → current catalog titles (per band). */
const LEGACY_TITLE_ALIASES: Record<TextbookBand, Record<string, string>> = {
  junior: {
    "An Inspiring Journey to Mathematics": "Inspiring Journey",
    "Junior Secondary Oxford Mathematics for the New Century": "New Century",
    "Mathematics in Focus": "Mathematics in Focus (2nd)",
    "Mathematics in Focus (2nd edition)": "Mathematics in Focus (2nd)",
  },
  senior: {
    "Mathematics in Focus (2nd Edition)": "Mathematics in Focus (2nd)",
    "Oxford Mathematics for the New Century": "New Century",
    "Mathematics in Action (3rd Edition)": "Mathematics in Action (3rd)",
    "HKDSE Maths Insight": "Maths Insight",
  },
};

export function gradeToTextbookBand(grade: string): TextbookBand | null {
  const code = String(grade ?? "")
    .trim()
    .replace(/\s/g, "")
    .toUpperCase();
  const m = /^F\.?([1-6])$/.exec(code);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 1 && n <= 3) return "junior";
  if (n >= 4 && n <= 6) return "senior";
  return null;
}

export function getTextbookCatalog(band: TextbookBand): TextbookPublisherGroup[] {
  return band === "junior" ? JUNIOR_CATALOG : SENIOR_CATALOG;
}

/** M1/M2 workbook titles from student-progress-beyond-math.xlsx. */
const EXTENDED_MATHS_CATALOG: TextbookPublisherGroup[] = [
  {
    publisher: "Oxford",
    books: [{ title: "Senior Secondary Oxford Math for the New Century" }],
  },
  {
    publisher: "Pearson",
    books: [{ title: "HKDSE Mathematics in Action (Extended Part)" }],
  },
  {
    publisher: "Ephhk",
    books: [{ title: "Mathematics in Focus" }],
  },
  {
    publisher: "HKEP",
    books: [{ title: "New Progress in Senior Mathematics" }],
  },
];

export function getExtendedMathsCatalog(): TextbookPublisherGroup[] {
  return EXTENDED_MATHS_CATALOG;
}

export function formatTextbookPublisherValue(publisher: string, book: TextbookBook): string {
  return `${publisher} · ${book.title}`;
}

export function parseTextbookPublisherValue(raw: string): {
  publisher: string;
  book: TextbookBook | null;
} | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const dotted = /^(.+?)\s·\s(.+)$/.exec(s);
  if (dotted) {
    const publisher = dotted[1].trim();
    let title = dotted[2].trim();
    const legacyCode = /^\([A-Z]\)\s*(.+)$/.exec(title);
    if (legacyCode) title = legacyCode[1].trim();
    return { publisher, book: { title } };
  }

  return { publisher: s, book: null };
}

/** Display-only: Oxford · Book Title → Oxford */
export function textbookPublisherDisplayName(raw: string): string {
  const parsed = parseTextbookPublisherValue(raw);
  return parsed?.publisher ?? "";
}

function normalizeTitleForBand(band: TextbookBand, title: string): string {
  return LEGACY_TITLE_ALIASES[band][title] ?? title;
}

function resolveAgainstCatalog(
  storedValue: string,
  catalog: TextbookPublisherGroup[],
  normalizeTitle?: (title: string) => string,
): { publisher: string; book: TextbookBook | null } {
  const parsed = parseTextbookPublisherValue(storedValue);
  if (!parsed) return { publisher: "", book: null };

  const group = catalog.find((g) => g.publisher === parsed.publisher);
  if (!group) return { publisher: "", book: null };

  if (!parsed.book) {
    return { publisher: parsed.publisher, book: null };
  }

  const normalizedTitle = normalizeTitle ? normalizeTitle(parsed.book.title) : parsed.book.title;
  const match = group.books.find((b) => b.title === normalizedTitle);
  if (match) return { publisher: parsed.publisher, book: match };

  const fuzzy = group.books.find(
    (b) => b.title.toLowerCase() === normalizedTitle.toLowerCase(),
  );
  if (fuzzy) return { publisher: parsed.publisher, book: fuzzy };

  return { publisher: parsed.publisher, book: null };
}

export function resolveTextbookSelection(
  grade: string,
  storedValue: string,
): { publisher: string; book: TextbookBook | null } {
  const parsed = parseTextbookPublisherValue(storedValue);
  if (!parsed) return { publisher: "", book: null };

  const band = gradeToTextbookBand(grade);
  if (!band) return parsed;

  return resolveAgainstCatalog(storedValue, getTextbookCatalog(band), (title) =>
    normalizeTitleForBand(band, title),
  );
}

export function resolveExtendedMathsTextbookSelection(
  storedValue: string,
): { publisher: string; book: TextbookBook | null } {
  return resolveAgainstCatalog(storedValue, getExtendedMathsCatalog());
}
