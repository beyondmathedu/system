import type { TutorMonthLessonRow } from "@/lib/roomScheduleAggregate";

export type TutorMonthLessonRowWithPay = TutorMonthLessonRow & {
  hours: number;
  subtotal: number;
};

/** 來自 latest_tutor_rates／Tutor 頁 */
export type TutorPayRates = {
  junior: number;
  senior: number;
  single: number;
};

type Band = "junior" | "senior";

/** 初中／高中；無法辨識時視為初中（標準代碼 F1~F6） */
export function classifyGradeBand(grade: string): Band {
  const raw = grade.trim();
  if (!raw) return "junior";
  const g = raw.replace(/\s+/g, "");

  const compact = g.toUpperCase().replace(/\./g, "");
  const fm = /^F([1-6])$/i.exec(compact);
  if (fm) {
    const n = Number(fm[1]);
    if (n <= 3) return "junior";
    if (n <= 6) return "senior";
  }
  const p = /^P([1-6])$/i.exec(compact);
  if (p) return "junior";

  if (/^小[一二三四五六]$/.test(g)) return "junior";

  return "junior";
}

/**
 * 年級權重（越大 = 年級越高），用於多人時段決定誰拿「第一席位」金額。
 * 小學 1–6 低於 F1~F6（7–12）；無法辨識時為 0（排最後）。
 */
export function gradeRank(grade: string): number {
  const raw = grade.trim();
  if (!raw) return 0;
  const g = raw.replace(/\s+/g, "");
  const zhDigit: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
  };

  const siu = /^小([一二三四五六])$/.exec(g);
  if (siu) return zhDigit[siu[1]] ?? 0;

  const compact = g.toUpperCase().replace(/\./g, "");
  const fm = /^F([1-6])$/i.exec(compact);
  if (fm) return 6 + Number(fm[1]);

  const p = /^P([1-6])$/i.exec(compact);
  if (p) return Number(p[1]);

  return 0;
}

function bandRate(band: Band, rates: TutorPayRates): number {
  return band === "senior" ? rates.senior : rates.junior;
}

/**
 * 同一時段：1 人＝單人價；2 人起第一位＝firstSeatAmount，其餘依初中／高中價。
 * 排序：年級最高者拿「第一席位」金額；同年級則依學號。
 */
function allocateSlotSubtotals(bands: Band[], rates: TutorPayRates, firstSeatAmount: number): number[] {
  const n = bands.length;
  if (n === 0) return [];
  if (n === 1) return [rates.single];
  return bands.map((band, i) => (i === 0 ? firstSeatAmount : bandRate(band, rates)));
}

/** 與 parseLessonHours 共用：還原課表字串裡的起迄時間（12h 制顯示用） */
function parseHmTo24(h: number, m: number, apRaw?: string): { h24: number; m: number } {
  let hh = h;
  const apu = (apRaw ?? "").toLowerCase().replace(/\./g, "");
  if (apu.includes("p")) hh = hh === 12 ? 12 : hh + 12;
  if (apu.includes("a") && apu.includes("m") && hh === 12) hh = 0;
  return { h24: hh, m };
}

function parseHmDecimal(h: number, m: number, apRaw?: string): number {
  const { h24, m: mm } = parseHmTo24(h, m, apRaw);
  return h24 + mm / 60;
}

function normalizeLessonTimeRaw(t: string): string {
  return t
    .trim()
    .replace(/\s*->\s*/gi, " – ")
    .replace(/(a\.m\.|p\.m\.)\s*\.\s*(?=[-–—~至到])/gi, "$1 ")
    .replace(/\s+/g, " ");
}

function tryMatchTimeRange(t: string): RegExpExecArray | null {
  const apSuffix = String.raw`(a\.m\.|p\.m\.|AM|PM|am|pm)?`;
  const between = String.raw`\s*\.?\s*[-–—~至到]\s*`;
  const variants = [t, normalizeLessonTimeRaw(t), normalizeLessonTimeRaw(t).replace(/\s+/g, "")];
  for (const v of variants) {
    const spaced = new RegExp(
      String.raw`(\d{1,2}):(\d{2})\s*${apSuffix}${between}(\d{1,2}):(\d{2})\s*${apSuffix}`,
      "i",
    ).exec(v);
    if (spaced) return spaced;
    const glued = new RegExp(
      String.raw`(\d{1,2}):(\d{2})${apSuffix}[-–—~至到](\d{1,2}):(\d{2})${apSuffix}`,
      "i",
    ).exec(v.replace(/\s+/g, ""));
    if (glued) return glued;
  }
  return null;
}

function formatClock24En(h24: number, m: number): string {
  const d = new Date(Date.UTC(2000, 0, 1, h24 % 24, m, 0));
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(d);
}

/** 課表常只存單一「4:30 PM」；24h「16:30」亦支援 */
function tryParseSingleClock(t: string): { h24: number; m: number } | null {
  const s = t.trim();
  if (!s || s === "待定") return null;
  const apSuffix = String.raw`(a\.m\.|p\.m\.|AM|PM|am|pm)?`;
  const withAp = new RegExp(String.raw`^(\d{1,2}):(\d{2})\s*${apSuffix}\s*$`, "i").exec(s);
  if (withAp) {
    return parseHmTo24(Number(withAp[1]), Number(withAp[2]), withAp[3]);
  }
  const h24m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (h24m) {
    const h = Number(h24m[1]);
    const mm = Number(h24m[2]);
    if (h >= 0 && h < 24 && mm >= 0 && mm < 60) return { h24: h, m: mm };
  }
  return null;
}

function addHoursToClock(h24: number, m: number, dh: number): { h24: number; m: number } {
  const totalMin = h24 * 60 + m + Math.round(dh * 60);
  const wrapped = ((totalMin % (24 * 60)) + (24 * 60)) % (24 * 60);
  return { h24: Math.floor(wrapped / 60), m: wrapped % 60 };
}

/**
 * 導師月表「時間」欄：正規化為「4:30 PM – 6:00 PM」。
 * - 若字串已是區間則直接格式化；
 * - 若只有開始時間（與課表預設一致），用 **hours** 推算結束時間。
 */
export function formatLessonTimeRangeLine(rawTime: string, hours: number): string | null {
  const range = tryMatchTimeRange(rawTime);
  if (range) {
    const a = parseHmDecimal(Number(range[1]), Number(range[2]), range[3]);
    const b = parseHmDecimal(Number(range[4]), Number(range[5]), range[6]);
    const d = Math.abs(b - a);
    if (d < 0.25 || d > 6) return null;
    const s = parseHmTo24(Number(range[1]), Number(range[2]), range[3]);
    const e = parseHmTo24(Number(range[4]), Number(range[5]), range[6]);
    return `${formatClock24En(s.h24, s.m)} – ${formatClock24En(e.h24, e.m)}`;
  }

  const start = tryParseSingleClock(rawTime);
  if (start && hours > 0 && hours <= 8) {
    const end = addHoursToClock(start.h24, start.m, hours);
    return `${formatClock24En(start.h24, start.m)} – ${formatClock24En(end.h24, end.m)}`;
  }

  return null;
}

/** 例：1.5 hr period（與時數欄數字一致） */
export function formatLessonHoursPeriodLabel(hours: number): string {
  const x = Math.round(hours * 100) / 100;
  let s: string;
  if (Number.isInteger(x)) s = String(x);
  else if (Math.abs(x * 10 - Math.round(x * 10)) < 1e-9) s = x.toFixed(1);
  else s = x.toFixed(2);
  return `${s} hr period`;
}

export function parseLessonHours(time: string): number {
  const t = time.trim();
  if (!t) return 1.5;

  const range = tryMatchTimeRange(t);
  if (range) {
    const a = parseHmDecimal(Number(range[1]), Number(range[2]), range[3]);
    const b = parseHmDecimal(Number(range[4]), Number(range[5]), range[6]);
    const d = Math.abs(b - a);
    if (d >= 0.25 && d <= 6) return Math.round(d * 100) / 100;
  }

  return 1.5;
}

function payGroupKey(dateIso: string, time: string): string {
  return `${dateIso}|||${time.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function sortRowsInPayGroup(rows: TutorMonthLessonRow[]): TutorMonthLessonRow[] {
  return [...rows].sort((a, b) => {
    const ra = gradeRank(a.grade);
    const rb = gradeRank(b.grade);
    if (rb !== ra) return rb - ra;
    return a.studentId.localeCompare(b.studentId);
  });
}

export function enrichTutorMonthRowsWithPay(
  rows: TutorMonthLessonRow[],
  rates: TutorPayRates,
  multiStudentFirstAmount: number,
): { rowsWithPay: TutorMonthLessonRowWithPay[]; monthTotal: number } {
  const bandCache = new Map<string, Band>();
  function bandOf(grade: string): Band {
    let b = bandCache.get(grade);
    if (b === undefined) {
      b = classifyGradeBand(grade);
      bandCache.set(grade, b);
    }
    return b;
  }

  const hoursCache = new Map<string, number>();
  function hoursOf(time: string): number {
    let h = hoursCache.get(time);
    if (h === undefined) {
      h = parseLessonHours(time);
      hoursCache.set(time, h);
    }
    return h;
  }

  const groups = new Map<string, TutorMonthLessonRow[]>();
  for (const r of rows) {
    const k = payGroupKey(r.dateIso, r.time);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }

  const subtotalByRowKey = new Map<string, number>();
  for (const [, groupRows] of groups) {
    const sorted = sortRowsInPayGroup(groupRows);
    const bands = sorted.map((r) => bandOf(r.grade));
    const amounts = allocateSlotSubtotals(bands, rates, multiStudentFirstAmount);
    sorted.forEach((r, i) => {
      subtotalByRowKey.set(r.rowKey, amounts[i] ?? 0);
    });
  }

  let monthTotal = 0;
  const rowsWithPay: TutorMonthLessonRowWithPay[] = rows.map((r) => {
    const hours = hoursOf(r.time);
    const subtotal = subtotalByRowKey.get(r.rowKey) ?? 0;
    monthTotal += subtotal;
    return { ...r, hours, subtotal };
  });

  return { rowsWithPay, monthTotal };
}
