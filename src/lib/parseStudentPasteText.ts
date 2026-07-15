/**
 * Paste-to-fill helper for the Students page form.
 * Accepts labeled lines (中文／英文) or enrollment-sheet tab rows.
 * Missing fields are fine — only filled values are written into the form.
 */

import { formatGradeDisplay, normalizeGradeCode } from "@/lib/grade";
import {
  formatTextbookPublisherValue,
  getTextbookCatalog,
  gradeToTextbookBand,
  resolveTextbookSelection,
} from "@/lib/textbookPublisherCatalog";

export type StudentPasteFields = {
  nameZh: string;
  nameEn: string;
  nicknameEn: string;
  birthDate: string;
  studentPhone: string;
  email: string;
  school: string;
  grade: string;
  textbookPublisher: string;
  mathLanguage: string;
};

export type StudentPasteResult = {
  fields: Partial<StudentPasteFields>;
  matchedLabels: string[];
  warnings: string[];
};

const LABEL_ALIASES: Record<keyof StudentPasteFields, string[]> = {
  nameZh: ["中文名", "中文姓名", "學生中文名", "姓名（中）", "chinese name", "name zh", "name_zh"],
  nameEn: ["英文名", "英文姓名", "學生英文名", "姓名（英）", "english name", "name en", "name_en"],
  nicknameEn: ["暱稱", "別名", "nickname", "nick"],
  birthDate: ["出生日期", "生日", "date of birth", "dob", "birth date", "birth_date"],
  studentPhone: ["電話", "聯絡電話", "手機", "contact number", "phone", "mobile", "whatsapp"],
  email: ["電郵", "電郵地址", "電子郵箱", "email", "e-mail"],
  school: ["學校", "就讀學校", "school"],
  grade: ["年級", "級別", "grade", "form"],
  textbookPublisher: [
    "教科書",
    "課本",
    "出版社",
    "textbook",
    "textbook publisher",
    "publisher",
  ],
  mathLanguage: ["教學語言", "數學教學語言", "授課語言", "maths language", "math language", "language"],
};

/** Enrollment sheet order (your WhatsApp / Excel copy). */
const ENROLLMENT_SHEET_KEYS: (keyof StudentPasteFields)[] = [
  "nameEn",
  "nicknameEn",
  "birthDate",
  "studentPhone",
  "email",
  "school",
  "grade",
  "mathLanguage",
  "textbookPublisher",
];

/** Alternative: Chinese name first. */
const LEGACY_ORDERED_KEYS: (keyof StudentPasteFields)[] = [
  "nameZh",
  "nameEn",
  "nicknameEn",
  "birthDate",
  "studentPhone",
  "email",
  "school",
  "grade",
  "textbookPublisher",
  "mathLanguage",
];

const PLACEHOLDER_TEXT = /^(x+|n\/?a|nil|null|none|—|-|－|無|沒有|待定|tbd|\.{2,})$/i;

const CN_NUM: Record<string, string> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
};

function normalizeKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_/]/g, " ")
    .replace(/\s+/g, " ");
}

function findFieldForLabel(label: string): keyof StudentPasteFields | null {
  const key = normalizeKey(label);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(LABEL_ALIASES) as Array<
    [keyof StudentPasteFields, string[]]
  >) {
    for (const alias of aliases) {
      if (key === normalizeKey(alias) || key.includes(normalizeKey(alias))) {
        return field;
      }
    }
  }
  return null;
}

function isPlaceholder(raw: string): boolean {
  return PLACEHOLDER_TEXT.test(String(raw ?? "").trim());
}

function normalizeBirthDate(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s || isPlaceholder(s)) return "";

  const cn = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/.exec(s);
  if (cn) {
    return `${cn[1]}-${cn[2].padStart(2, "0")}-${cn[3].padStart(2, "0")}`;
  }

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return "";
}

function normalizeGrade(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s || isPlaceholder(s)) return "";

  const display = formatGradeDisplay(normalizeGradeCode(s));
  if (/^F\.[1-6]$/.test(display)) return display;

  const cnForm = /^中\s*([一二三四五六1-6])\s*(?:年級)?$/i.exec(s);
  if (cnForm) {
    const n = CN_NUM[cnForm[1]];
    if (n) return `F.${n}`;
  }

  const loose = /(?:F\.?\s*|Form\s*)([1-6])/i.exec(s);
  if (loose) return `F.${loose[1]}`;
  return "";
}

function normalizeMathLanguage(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s || isPlaceholder(s)) return "";
  const lower = s.toLowerCase();
  if (
    lower === "chinese" ||
    s === "中文" ||
    s === "中" ||
    lower.includes("chinese") ||
    s.includes("中文") ||
    lower === "chi" ||
    lower === "zh"
  ) {
    return "Chinese";
  }
  if (
    lower === "english" ||
    s === "英文" ||
    s === "英" ||
    lower.includes("english") ||
    s.includes("英文") ||
    lower === "eng" ||
    lower === "en"
  ) {
    return "English";
  }
  return "";
}

/**
 * Match pasted textbook text against the catalog for the given grade.
 * Accepts: "Oxford · New Century", "Oxford New Century", "Oxford", "New Century".
 */
export function matchTextbookFromFreeText(grade: string, raw: string): {
  value: string;
  warning?: string;
} {
  const text = String(raw ?? "").trim();
  if (!text || isPlaceholder(text)) return { value: "" };

  const resolved = resolveTextbookSelection(grade, text);
  if (resolved.publisher && resolved.book) {
    return { value: formatTextbookPublisherValue(resolved.publisher, resolved.book) };
  }

  const band = gradeToTextbookBand(grade);
  if (!band) {
    return {
      value: "",
      warning: "Grade missing/unparsed — pick Textbook publisher manually if needed.",
    };
  }

  const catalog = getTextbookCatalog(band);
  const lower = text.toLowerCase();

  for (const group of catalog) {
    const pub = group.publisher.toLowerCase();
    if (!lower.includes(pub) && lower !== pub) continue;
    for (const book of group.books) {
      if (lower.includes(book.title.toLowerCase())) {
        return { value: formatTextbookPublisherValue(group.publisher, book) };
      }
    }
    if (group.books.length === 1) {
      return {
        value: formatTextbookPublisherValue(group.publisher, group.books[0]!),
        warning: `Matched publisher ${group.publisher}; book auto-selected (${group.books[0]!.title}). Confirm below.`,
      };
    }
    return {
      value: "",
      warning: `Matched publisher ${group.publisher}, but please pick the book below.`,
    };
  }

  for (const group of catalog) {
    for (const book of group.books) {
      if (lower === book.title.toLowerCase() || lower.includes(book.title.toLowerCase())) {
        return { value: formatTextbookPublisherValue(group.publisher, book) };
      }
    }
  }

  return {
    value: "",
    warning: `Could not match textbook “${text}”. Leave blank or choose manually (optional).`,
  };
}

function normalizePhone(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s || isPlaceholder(s)) return "";
  return s.replace(/[^\d+]/g, "");
}

function applyNormalizedField(
  field: keyof StudentPasteFields,
  raw: string,
  gradeHint: string,
): { value: string; warning?: string } {
  const v = String(raw ?? "").trim();
  if (!v || isPlaceholder(v)) return { value: "" };
  switch (field) {
    case "birthDate": {
      const d = normalizeBirthDate(v);
      return d
        ? { value: d }
        : { value: "", warning: `Could not parse birth date “${v}” (skipped; optional).` };
    }
    case "grade": {
      const g = normalizeGrade(v);
      return g
        ? { value: g }
        : { value: "", warning: `Could not parse grade “${v}” (use 中一–中六 or F.1–F.6; optional).` };
    }
    case "mathLanguage": {
      const lang = normalizeMathLanguage(v);
      return lang
        ? { value: lang }
        : { value: "", warning: `Could not parse maths language “${v}” (skipped; optional).` };
    }
    case "studentPhone":
      return { value: normalizePhone(v) || v };
    case "email":
      return { value: v };
    case "textbookPublisher":
      return matchTextbookFromFreeText(gradeHint, v);
    default:
      return { value: v };
  }
}

function parseLabeledLines(text: string): StudentPasteResult {
  const fields: Partial<StudentPasteFields> = {};
  const matchedLabels: string[] = [];
  const warnings: string[] = [];
  let gradeHint = "";

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = /^([^:：\t]+)[:：\t]\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = findFieldForLabel(m[1]);
    if (!field) continue;
    if (field === "grade") {
      const { value, warning } = applyNormalizedField(field, m[2], gradeHint);
      if (value) {
        fields.grade = value;
        gradeHint = value;
        matchedLabels.push(field);
      }
      if (warning) warnings.push(warning);
      continue;
    }
    const { value, warning } = applyNormalizedField(field, m[2], gradeHint || fields.grade || "");
    if (value) {
      (fields as Record<string, string>)[field] = value;
      matchedLabels.push(field);
    }
    if (warning) warnings.push(warning);
  }

  if (!fields.textbookPublisher) {
    for (const line of lines) {
      const m = /^([^:：\t]+)[:：\t]\s*(.*)$/.exec(line);
      if (!m) continue;
      if (findFieldForLabel(m[1]) !== "textbookPublisher") continue;
      const { value, warning } = applyNormalizedField(
        "textbookPublisher",
        m[2],
        fields.grade || "",
      );
      if (value) {
        fields.textbookPublisher = value;
        matchedLabels.push("textbookPublisher");
      }
      if (warning) warnings.push(warning);
    }
  }

  return { fields, matchedLabels: Array.from(new Set(matchedLabels)), warnings };
}

function looksLikeEnrollmentSheet(parts: string[]): boolean {
  if (parts.length < 5) return false;
  if (normalizeGrade(parts[6] ?? "")) return true;
  if (/年\s*\d{1,2}\s*月/.test(parts[2] ?? "")) return true;
  if (/@/.test(parts[4] ?? "")) return true;
  // First cell mostly Latin → English-name-first sheet
  const first = parts[0] ?? "";
  if (first && !/[\u4e00-\u9fff]/.test(first) && /[A-Za-z]/.test(first)) return true;
  return false;
}

function parseWithKeys(
  parts: string[],
  keys: (keyof StudentPasteFields)[],
): StudentPasteResult {
  const fields: Partial<StudentPasteFields> = {};
  const matchedLabels: string[] = [];
  const warnings: string[] = [];

  const gradeIdx = keys.indexOf("grade");
  let gradeHint =
    gradeIdx >= 0 && parts[gradeIdx] ? normalizeGrade(parts[gradeIdx]!) : "";

  parts.forEach((part, i) => {
    const field = keys[i];
    if (!field || !part || isPlaceholder(part)) return;
    const { value, warning } = applyNormalizedField(field, part, gradeHint);
    if (field === "grade" && value) gradeHint = value;
    if (value) {
      (fields as Record<string, string>)[field] = value;
      matchedLabels.push(field);
    }
    if (warning) warnings.push(warning);
  });

  return { fields, matchedLabels, warnings };
}

function parseDelimitedRow(text: string): StudentPasteResult | null {
  const singleLine = text.trim();
  if (!singleLine || /\r?\n/.test(singleLine)) return null;
  const parts = singleLine.includes("\t")
    ? singleLine.split("\t").map((p) => p.trim())
    : singleLine.split(",").map((p) => p.trim());
  // Allow sparse rows (e.g. only name + phone)
  if (parts.filter(Boolean).length < 1) return null;

  const keys = looksLikeEnrollmentSheet(parts) ? ENROLLMENT_SHEET_KEYS : LEGACY_ORDERED_KEYS;
  const result = parseWithKeys(parts, keys);
  if (result.matchedLabels.length === 0) return null;
  return result;
}

function looksLikeDelimitedStudentRow(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.includes("\t")) return true;
  // Comma row with enough cells, and not a "Label: value" line
  if (/^[^:：]+[:：]/.test(t)) return false;
  return t.split(",").length >= 3;
}

export type StudentPasteBatchResult = {
  students: StudentPasteResult[];
  warnings: string[];
};

/** Parse one or many students. Multi-line tab/CSV = one student per line. */
export function parseStudentPasteBatch(raw: string): StudentPasteBatchResult {
  const text = String(raw ?? "").trim();
  if (!text) {
    return { students: [], warnings: ["Paste is empty."] };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const delimitedLines = lines.filter(looksLikeDelimitedStudentRow);

  if (delimitedLines.length >= 1 && delimitedLines.length === lines.length) {
    const students: StudentPasteResult[] = [];
    const warnings: string[] = [];
    delimitedLines.forEach((line, idx) => {
      const row = parseDelimitedRow(line);
      if (!row || row.matchedLabels.length === 0) {
        warnings.push(`Row ${idx + 1}: could not parse.`);
        return;
      }
      students.push(row);
      for (const w of row.warnings) {
        warnings.push(`Row ${idx + 1}: ${w}`);
      }
    });
    if (students.length === 0) {
      return {
        students: [],
        warnings:
          warnings.length > 0
            ? warnings
            : [
                "Could not parse. Tab order: English name, Nickname, Birth, Phone, Email, School, Grade, Language, Textbook. One student per line.",
              ],
      };
    }
    return { students, warnings };
  }

  // Single labeled block → one student
  const labeled = parseLabeledLines(text);
  if (labeled.matchedLabels.length > 0) {
    return { students: [labeled], warnings: labeled.warnings };
  }

  const single = parseDelimitedRow(text);
  if (single) {
    return { students: [single], warnings: single.warnings };
  }

  return {
    students: [],
    warnings: [
      "Could not parse. Paste one student per line (tab-separated), or labeled lines for a single student. Empty cells are OK.",
    ],
  };
}

export function parseStudentPasteText(raw: string): StudentPasteResult {
  const batch = parseStudentPasteBatch(raw);
  if (batch.students.length === 0) {
    return { fields: {}, matchedLabels: [], warnings: batch.warnings };
  }
  if (batch.students.length === 1) return batch.students[0]!;
  return {
    fields: batch.students[0]!.fields,
    matchedLabels: batch.students[0]!.matchedLabels,
    warnings: [
      ...batch.warnings,
      `Detected ${batch.students.length} students — use “Add all” to insert them together.`,
    ],
  };
}
