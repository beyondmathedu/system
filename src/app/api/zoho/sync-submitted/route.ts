import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";
import { gradeForFeePricing, sumSlotTuitionHkdByLessonCount } from "@/lib/studentFeePricingGrade";
import {
  loadStudentFeeTierSettingsAdmin,
  resolveFeeTierSettingsForStudent,
} from "@/lib/studentFeeTierSettings";
import { FEE_RECORD_SELECT_PRICING } from "@/lib/studentMonthlyFeeRecordsCompat";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type ZohoSalesReceipt = {
  sales_receipt_id?: string;
  salesreceipt_id?: string;
  customer_id?: string;
  customer_name?: string;
  customer_name_formatted?: string;
  company_name?: string;
  line_items?: Array<{
    name?: string;
    item_name?: string;
    description?: string;
    quantity?: number | string;
    [key: string]: unknown;
  }>;
};

type ZohoTokenResponse = { access_token?: string; error?: string };
type ZohoSalesReceiptListResponse = {
  code?: number;
  salesreceipts?: ZohoSalesReceipt[];
  sales_receipts?: ZohoSalesReceipt[];
  page_context?: { has_more_page?: boolean };
};
type ZohoSalesReceiptDetailResponse = {
  code?: number;
  message?: string;
  sales_receipt?: ZohoSalesReceipt;
  salesreceipt?: ZohoSalesReceipt;
  sales_receipt_details?: ZohoSalesReceipt;
};
type SyncRequestBody = { year?: number; month?: number; studentIds?: string[]; idOnly?: boolean };
type StudentNameRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  nickname_en: string | null;
  grade: string | null;
};
type ExistingFeeRow = {
  student_id: string;
  year: number;
  month: number;
  lesson_unit_price: number | null;
  fee_pricing_grade: string | null;
};

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

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractBillToCode(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/\b\d{2,6}\b/);
  if (!m) return null;
  return m[0];
}

function studentIdFromBillToCode(code: string, studentIdSet: Set<string>): string | null {
  const n = Number(code);
  if (!Number.isFinite(n) || n <= 0) return null;
  const raw = String(Math.trunc(n));
  const candidates = [raw.padStart(5, "0"), raw.padStart(4, "0"), raw.padStart(3, "0"), raw];
  for (const c of candidates) {
    if (studentIdSet.has(c)) return c;
  }
  return null;
}

function monthFromText(text: string): number | null {
  const t = text.toLowerCase();
  const zh = /([1-9]|1[0-2])\s*月/.exec(t);
  if (zh) return Number(zh[1]);
  const en = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.exec(
    text,
  );
  if (!en) return null;
  return MONTH_MAP[en[1].toLowerCase()] ?? null;
}

/** Zoho 行 quantity＝已繳堂數（括號提示）；Total HKD（item_total 等）＝ Tuition Paid 金額。 */
function parseZohoNumber(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const x = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : NaN;
}

function lineItemDescriptionText(li: Record<string, unknown>): string {
  return [li.item_name, li.name, li.description]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/** F.1–F.6 課程行（含 "Math Course" 或 "F.5 Jul Sat" 等）；排除文具。 */
function isTuitionLineItem(li: Record<string, unknown>): boolean {
  const text = lineItemDescriptionText(li).toLowerCase();
  if (text.includes("math course")) return true;
  return /\bf\.?\s*[1-6]\b/.test(text);
}

function tuitionLineGrossFromItems(
  lineItems: Array<NonNullable<ZohoSalesReceipt["line_items"]>[number]>,
): number {
  let gross = 0;
  for (const li of lineItems) {
    const liRec = li as Record<string, unknown>;
    if (!isTuitionLineItem(liRec)) continue;
    gross += lineItemGrossHkd(liRec);
  }
  return Math.round(gross * 100) / 100;
}

/** List API 常缺折扣後 total；有課程行就拉 detail 取實收 Total HKD。 */
function shouldFetchReceiptDetail(
  receiptId: string,
  lineItems: Array<NonNullable<ZohoSalesReceipt["line_items"]>[number]>,
  receiptNet: number,
): boolean {
  if (!receiptId) return false;
  if (lineItems.length === 0 || receiptNet <= 0) return true;
  const tuitionGross = tuitionLineGrossFromItems(lineItems);
  if (tuitionGross > 0) return true;
  return false;
}

function matchStudentIdFromReceipt(
  r: ZohoSalesReceipt,
  studentIdSet: Set<string>,
  byName: Map<string, string>,
  idOnly: boolean,
  narrowStudents?: StudentNameRow[],
): string | null {
  for (const field of [r.company_name, r.customer_name, r.customer_name_formatted]) {
    const code = extractBillToCode(String(field ?? ""));
    if (!code) continue;
    const sid = studentIdFromBillToCode(code, studentIdSet);
    if (sid) return sid;
  }

  const keyA = normalizeName(String(r.customer_name ?? ""));
  const keyB = normalizeName(String(r.customer_name_formatted ?? ""));

  if (!idOnly) {
    return byName.get(keyA) ?? byName.get(keyB) ?? null;
  }

  if (!narrowStudents?.length) return null;
  const byId = byName.get(keyA) ?? byName.get(keyB);
  if (byId) return byId;

  const blob = normalizeName(
    [r.customer_name, r.customer_name_formatted, r.company_name]
      .map((x) => String(x ?? ""))
      .join(" "),
  );
  if (!blob) return null;

  let found: string | null = null;
  for (const s of narrowStudents) {
    const id = String(s.id ?? "").trim();
    if (!id || !studentIdSet.has(id)) continue;
    const idNorm = normalizeName(id);
    const zh = normalizeName(String(s.name_zh ?? ""));
    const nick = normalizeName(String(s.nickname_en ?? ""));
    const en = normalizeName(String(s.name_en ?? ""));

    if (idNorm && blob.includes(idNorm)) {
      if (found && found !== id) return null;
      found = id;
      continue;
    }
    if (zh.length >= 2 && blob.includes(zh)) {
      if (!nick || blob.includes(nick) || blob.includes(idNorm)) {
        if (found && found !== id) return null;
        found = id;
        continue;
      }
    }
    const alias = nick || en;
    if (alias.length >= 4 && blob.includes(alias)) {
      if (found && found !== id) return null;
      found = id;
    }
  }
  return found;
}

function lineItemLessonCount(li: Record<string, unknown>): number {
  const qty = parseZohoNumber(li.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.round(qty * 100) / 100;
}

/** Receipt header Total HKD（折扣後實收）。 */
function receiptTotalHkd(receipt: Record<string, unknown>): number {
  const total = parseZohoNumber(receipt.total ?? receipt.bcy_total ?? receipt.grand_total);
  const subTotal = parseZohoNumber(receipt.sub_total ?? receipt.bcy_sub_total);
  const discount = parseZohoNumber(
    receipt.discount_total ?? receipt.discount_amount ?? receipt.total_discount ?? receipt.discount,
  );
  if (Number.isFinite(total) && total > 0) {
    if (
      Number.isFinite(subTotal) &&
      Number.isFinite(discount) &&
      discount > 0 &&
      Math.abs(subTotal - discount - total) < 0.02
    ) {
      return Math.round(total * 100) / 100;
    }
    return Math.round(total * 100) / 100;
  }
  if (Number.isFinite(subTotal) && Number.isFinite(discount) && discount > 0 && subTotal > discount) {
    return Math.round((subTotal - discount) * 100) / 100;
  }
  if (Number.isFinite(subTotal) && subTotal > 0) {
    return Math.round(subTotal * 100) / 100;
  }
  return 0;
}

/** Line gross before receipt-level discount (rate×qty preferred). */
function lineItemGrossHkd(li: Record<string, unknown>): number {
  const rate = parseZohoNumber(li.rate);
  const qty = parseZohoNumber(li.quantity);
  if (Number.isFinite(rate) && Number.isFinite(qty) && rate > 0 && qty > 0) {
    return Math.round(rate * qty * 100) / 100;
  }
  for (const key of ["item_total", "line_item_total", "amount", "bcy_amount"]) {
    const n = parseZohoNumber(li[key]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return 0;
}

/** Line net after line-level discount (item_total may be less than rate×qty). */
function lineItemNetHkd(li: Record<string, unknown>): number {
  const gross = lineItemGrossHkd(li);
  for (const key of ["item_total", "item_total_inclusive_of_tax", "line_item_total", "bcy_amount"]) {
    const n = parseZohoNumber(li[key]);
    if (Number.isFinite(n) && n > 0 && gross > 0 && n + 0.005 < gross) {
      return Math.round(n * 100) / 100;
    }
  }
  const discount = parseZohoNumber(li.discount_amount ?? li.discount);
  if (Number.isFinite(discount) && discount > 0 && gross > discount) {
    return Math.round((gross - discount) * 100) / 100;
  }
  return gross;
}

function lineItemLessonCountWithFallback(li: Record<string, unknown>, receiptNotes: string): number {
  const qty = lineItemLessonCount(li);
  if (qty > 0) return qty;
  const blob = [receiptNotes, lineItemDescriptionText(li), JSON.stringify(li)].join(" ");
  const zh = /(\d+(?:\.\d+)?)\s*堂/.exec(blob);
  if (zh) return Math.round(Number(zh[1]) * 100) / 100;
  const en = /\bqty\b[^0-9]*(\d+(?:\.\d+)?)/i.exec(blob);
  if (en) return Math.round(Number(en[1]) * 100) / 100;
  return 0;
}

async function getZohoAccessToken(): Promise<string> {
  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const resp = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = (await resp.json()) as ZohoTokenResponse;
  if (!resp.ok || json.error || !json.access_token) {
    throw new Error(`Zoho token error: ${JSON.stringify(json)}`);
  }
  return String(json.access_token);
}

function toIsoYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildSyncWindow(
  year: number,
  month: number,
  widenToFullYear: boolean,
): { dateStart: string; dateEnd: string } {
  if (widenToFullYear) {
    return { dateStart: `${year}-01-01`, dateEnd: `${year}-12-31` };
  }
  const base = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 2, 0));
  return { dateStart: toIsoYmdUtc(start), dateEnd: toIsoYmdUtc(end) };
}

function monthFromReceiptDate(receipt: Record<string, unknown>, targetYear: number): number | null {
  const d = String(receipt.date ?? receipt.receipt_date ?? "").trim();
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(d);
  if (!m) return null;
  if (Number(m[1]) !== targetYear) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? mo : null;
}

async function fetchAllReceipts(
  accessToken: string,
  orgId: string,
  dateStart: string,
  dateEnd: string,
): Promise<ZohoSalesReceipt[]> {
  const out: ZohoSalesReceipt[] = [];
  let page = 1;
  while (page <= 25) {
    const url =
      `https://www.zohoapis.com/books/v3/salesreceipts?organization_id=${encodeURIComponent(orgId)}` +
      `&date_start=${dateStart}&date_end=${dateEnd}&per_page=200&page=${page}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      cache: "no-store",
    });
    const json = (await resp.json()) as ZohoSalesReceiptListResponse;
    if (json.code === 45) {
      throw new Error("ZOHO_RATE_LIMIT_EXCEEDED");
    }
    if (!resp.ok || json.code !== 0) {
      throw new Error(`Zoho salesreceipts error: ${JSON.stringify(json)}`);
    }
    const rows = (json.sales_receipts ?? json.salesreceipts ?? []) as ZohoSalesReceipt[];
    out.push(...rows);
    const hasMore = Boolean(json.page_context?.has_more_page);
    if (!hasMore || rows.length === 0) break;
    page += 1;
  }
  return out;
}

async function fetchReceiptDetail(
  accessToken: string,
  orgId: string,
  receiptId: string,
): Promise<{ receipt: ZohoSalesReceipt | null; errorCode?: number; errorMessage?: string }> {
  const url = `https://www.zohoapis.com/books/v3/salesreceipts/${encodeURIComponent(receiptId)}?organization_id=${encodeURIComponent(orgId)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    cache: "no-store",
  });
  const rawText = await resp.text();
  let json: ZohoSalesReceiptDetailResponse | null = null;
  try {
    json = JSON.parse(rawText) as ZohoSalesReceiptDetailResponse;
  } catch {
    return {
      receipt: null,
      errorCode: resp.status,
      errorMessage: `non_json_response:${rawText.slice(0, 180)}`,
    };
  }
  if (json.code === 45) {
    throw new Error("ZOHO_RATE_LIMIT_EXCEEDED");
  }
  if (!resp.ok || json.code !== 0) {
    return {
      receipt: null,
      errorCode: Number(json.code ?? resp.status ?? -1),
      errorMessage: String(json.message ?? `http_${resp.status}`),
    };
  }
  const receipt = json.sales_receipt ?? json.salesreceipt ?? json.sales_receipt_details ?? null;
  if (!receipt) {
    return {
      receipt: null,
      errorCode: Number(json.code ?? resp.status ?? -1),
      errorMessage: `missing_receipt_key:${Object.keys(json).join(",")}`,
    };
  }
  return { receipt };
}

function pickLineItems(
  receipt: ZohoSalesReceipt | null | undefined,
): Array<NonNullable<ZohoSalesReceipt["line_items"]>[number]> {
  if (!receipt || typeof receipt !== "object") return [];
  const raw = receipt as ZohoSalesReceipt & { lineitems?: ZohoSalesReceipt["line_items"] };
  if (Array.isArray(raw.line_items)) return raw.line_items;
  if (Array.isArray(raw.lineitems)) return raw.lineitems;
  return [];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      result[i] = await worker(items[i], i);
    }
  }
  const jobs = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => run());
  await Promise.all(jobs);
  return result;
}

export async function POST(request: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as SyncRequestBody;
    const year = Number(body?.year);
    if (!Number.isFinite(year) || year < 2020 || year > 2035) {
      return NextResponse.json({ ok: false, error: "invalid_year" }, { status: 400 });
    }
    const targetMonth = Number(body?.month);
    if (!Number.isFinite(targetMonth) || targetMonth < 1 || targetMonth > 12) {
      return NextResponse.json({ ok: false, error: "invalid_month" }, { status: 400 });
    }
    const idOnly = Boolean(body?.idOnly);
    const requestedStudentIds = Array.isArray(body?.studentIds)
      ? Array.from(
          new Set(
            body.studentIds
              .map((v) => String(v ?? "").trim())
              .filter(Boolean),
          ),
        )
      : null;
    const orgId = process.env.ZOHO_ORG_ID ?? "";
    if (!orgId) {
      return NextResponse.json({ ok: false, error: "missing_org_id" }, { status: 500 });
    }

    const admin = getSupabaseAdmin();
    let studentsQuery = admin.from("students").select("id, name_zh, name_en, nickname_en, grade");
    if (requestedStudentIds && requestedStudentIds.length > 0) {
      studentsQuery = studentsQuery.in("id", requestedStudentIds);
    }
    const { data: students, error: stErr } = await studentsQuery.returns<StudentNameRow[]>();
    if (stErr) {
      return NextResponse.json({ ok: false, error: stErr.message }, { status: 500 });
    }

    const narrowNameMatch = Boolean(requestedStudentIds?.length);
    const narrowStudents = narrowNameMatch ? (students ?? []) : undefined;

    const byName = new Map<string, string>();
    const studentIdSet = new Set<string>();
    const gradeByStudentId = new Map<string, string>();
    for (const s of students ?? []) {
      const id = String(s.id ?? "").trim();
      if (!id) continue;
      studentIdSet.add(id);
      gradeByStudentId.set(id, String(s.grade ?? "").trim());
      if (idOnly && !narrowNameMatch) continue;
      const zh = String(s.name_zh ?? "").trim();
      const en = String(s.name_en ?? "").trim();
      const nick = String(s.nickname_en ?? "").trim();
      const variants = [
        id,
        zh,
        en,
        nick,
        `${zh} ${en}`,
        `${zh} ${nick}`,
        `${zh}${en}`,
        `${zh}${nick}`,
        `${zh} (${id})`,
        `${zh}${nick} (${id})`,
      ];
      for (const v of variants) {
        const key = normalizeName(v);
        if (key) byName.set(key, id);
      }
    }

    const accessToken = await getZohoAccessToken();
    const widenWindow = Boolean(requestedStudentIds?.length);
    const { dateStart, dateEnd } = buildSyncWindow(year, targetMonth, widenWindow);
    const receipts = await fetchAllReceipts(accessToken, orgId, dateStart, dateEnd);
    const maxDetailCalls = 500;
    let detailCalls = 0;
    let skippedDetailByLimit = 0;
    let detailFetchSuccess = 0;
    let detailFetchEmpty = 0;
    let detailFetchError = 0;
    const detailErrorSamples: string[] = [];

    const lessonsByStudentMonth = new Map<string, number>();
    const amountByStudentMonth = new Map<string, number>();
    let unmatchedReceipts = 0;
    let parsedMonthLineItems = 0;
    let totalLineItems = 0;
    let skippedZeroQuantity = 0;
    let skippedNonCourseLineItems = 0;
    let detailFetchPreDiscount = 0;
    const zohoMatchedKeys = new Set<string>();
    const zohoMissingNetKeys = new Set<string>();

    const matchedReceipts: Array<{ receipt: ZohoSalesReceipt; studentId: string }> = [];
    for (const r of receipts) {
      const studentId = matchStudentIdFromReceipt(
        r,
        studentIdSet,
        byName,
        idOnly,
        narrowStudents,
      );
      if (!studentId) {
        unmatchedReceipts += 1;
        continue;
      }
      matchedReceipts.push({ receipt: r, studentId });
    }

    const withItems = await mapWithConcurrency(matchedReceipts, 8, async ({ receipt, studentId }) => {
      let activeReceipt: Record<string, unknown> = receipt as Record<string, unknown>;
      let lineItems = pickLineItems(receipt);
      const receiptId = String(receipt.sales_receipt_id ?? receipt.salesreceipt_id ?? "").trim();
      let receiptNet = receiptTotalHkd(activeReceipt);
      const needsDetail = shouldFetchReceiptDetail(receiptId, lineItems, receiptNet);
      if (needsDetail && lineItems.length > 0 && receiptNet > 0) {
        detailFetchPreDiscount += 1;
      }
      if (needsDetail) {
        if (detailCalls >= maxDetailCalls) {
          skippedDetailByLimit += 1;
        } else {
          detailCalls += 1;
          const detail = await fetchReceiptDetail(accessToken, orgId, receiptId);
          if (detail.receipt) {
            detailFetchSuccess += 1;
            activeReceipt = detail.receipt as Record<string, unknown>;
            lineItems = pickLineItems(detail.receipt);
            receiptNet = receiptTotalHkd(activeReceipt);
            if (!lineItems.length) detailFetchEmpty += 1;
          } else {
            detailFetchError += 1;
            if (detailErrorSamples.length < 5) {
              detailErrorSamples.push(
                `${receiptId}:${String(detail.errorCode ?? "unknown")}:${String(detail.errorMessage ?? "detail_failed")}`,
              );
            }
          }
        }
      }
      return { studentId, lineItems, receiptNet, activeReceipt, detailFetched: needsDetail && detailCalls > 0 };
    });

    for (const { studentId, lineItems, receiptNet, activeReceipt } of withItems) {
      type ParsedLine = { month: number; lessonCount: number; gross: number; net: number };
      const parsed: ParsedLine[] = [];
      let nonMathGross = 0;
      const receiptMonthFallback = monthFromReceiptDate(activeReceipt, year);
      const receiptNotes = String(activeReceipt.notes ?? activeReceipt.note ?? "");

      for (const li of lineItems) {
        totalLineItems += 1;
        const liRec = li as Record<string, unknown>;
        if (!isTuitionLineItem(liRec)) {
          skippedNonCourseLineItems += 1;
          nonMathGross += lineItemGrossHkd(liRec);
          continue;
        }
        const text = [li.item_name, li.name, li.description, receiptNotes, JSON.stringify(li)]
          .map((x) => String(x ?? "").trim())
          .join(" ");
        const month = monthFromText(text) ?? receiptMonthFallback;
        if (!month) continue;
        parsedMonthLineItems += 1;
        const lessonCount = lineItemLessonCountWithFallback(liRec, receiptNotes);
        const gross = lineItemGrossHkd(liRec);
        const net = lineItemNetHkd(liRec);
        if (lessonCount <= 0 && gross <= 0 && net <= 0) {
          skippedZeroQuantity += 1;
          continue;
        }
        parsed.push({ month, lessonCount, gross, net });
        zohoMatchedKeys.add(`${studentId}:${month}`);
      }

      const totalGross = parsed.reduce((s, r) => s + r.gross, 0);
      const totalNet = parsed.reduce((s, r) => s + r.net, 0);
      const mathOnlyNet =
        receiptNet > 0 ? Math.max(0, Math.round((receiptNet - nonMathGross) * 100) / 100) : 0;
      if (parsed.length > 0 && mathOnlyNet <= 0 && totalNet <= 0) {
        for (const row of parsed) {
          zohoMissingNetKeys.add(`${studentId}:${row.month}`);
        }
      }

      for (const row of parsed) {
        let paid = row.net;
        if (paid + 0.005 >= row.gross && mathOnlyNet > 0 && totalGross > 0 && mathOnlyNet + 0.005 < totalGross) {
          paid = Math.round((row.gross / totalGross) * mathOnlyNet * 100) / 100;
        } else if (paid + 0.005 >= row.gross && totalNet + 0.005 < totalGross) {
          paid = row.net;
        }
        const key = `${studentId}:${row.month}`;
        if (row.lessonCount > 0) {
          lessonsByStudentMonth.set(key, (lessonsByStudentMonth.get(key) ?? 0) + row.lessonCount);
        }
        if (paid > 0) {
          amountByStudentMonth.set(key, (amountByStudentMonth.get(key) ?? 0) + paid);
        }
      }
    }

    const feeTierBundle = await loadStudentFeeTierSettingsAdmin(admin);

    const studentIds = Array.from(
      new Set([
        ...Array.from(lessonsByStudentMonth.keys()).map((k) => k.split(":")[0]),
        ...Array.from(amountByStudentMonth.keys()).map((k) => k.split(":")[0]),
      ]),
    );
    const { data: existing } = studentIds.length
      ? await admin
          .from("student_monthly_fee_records")
          .select(FEE_RECORD_SELECT_PRICING)
          .eq("year", year)
          .in("student_id", studentIds)
          .returns<ExistingFeeRow[]>()
      : { data: [] as ExistingFeeRow[] };

    const existingMap = new Map<
      string,
      { lesson_unit_price: number | null; fee_pricing_grade: string | null }
    >();
    for (const row of existing ?? []) {
      const sid = String(row.student_id ?? "");
      const mo = Number(row.month ?? 0);
      if (!sid || !mo) continue;
      existingMap.set(`${sid}:${mo}`, {
        lesson_unit_price:
          row.lesson_unit_price == null || Number.isNaN(Number(row.lesson_unit_price))
            ? null
            : Number(row.lesson_unit_price),
        fee_pricing_grade: row.fee_pricing_grade == null ? null : String(row.fee_pricing_grade),
      });
    }

    const upserts: Array<{
      student_id: string;
      year: number;
      month: number;
      submitted_amount: number;
      submitted_lesson_count: number | null;
    }> = [];
    const allKeys = new Set([
      ...Array.from(lessonsByStudentMonth.keys()),
      ...Array.from(amountByStudentMonth.keys()),
    ]);
    for (const key of allKeys) {
      const [student_id, mStr] = key.split(":");
      const month = Number(mStr);
      const lessonCount = lessonsByStudentMonth.get(key) ?? 0;
      let submitted = amountByStudentMonth.get(key) ?? 0;
      if (submitted <= 0 && lessonCount > 0) {
        if (zohoMatchedKeys.has(key)) {
          continue;
        }
        const ex = existingMap.get(key);
        const gradeFor = gradeForFeePricing(
          gradeByStudentId.get(student_id) ?? "",
          year,
          month,
          ex?.fee_pricing_grade ?? "",
        );
        const tier = resolveFeeTierSettingsForStudent(feeTierBundle, student_id, year, month);
        submitted =
          Math.round(
            sumSlotTuitionHkdByLessonCount({ lessonCount, gradeFor, feeTierSettings: tier }) * 100,
          ) / 100;
      }
      if (submitted <= 0 && lessonCount <= 0) continue;
      upserts.push({
        student_id,
        year,
        month,
        submitted_amount: Math.round(submitted * 100) / 100,
        submitted_lesson_count: lessonCount > 0 ? lessonCount : null,
      });
    }

    if (upserts.length > 0) {
      let { error: upErr } = await admin
        .from("student_monthly_fee_records")
        .upsert(upserts, { onConflict: "student_id,year,month" });
      if (upErr && /submitted_lesson_count/i.test(upErr.message) && /column|schema cache/i.test(upErr.message)) {
        ({ error: upErr } = await admin.from("student_monthly_fee_records").upsert(
          upserts.map((row) => {
            const next = { ...row };
            delete (next as { submitted_lesson_count?: number }).submitted_lesson_count;
            return next;
          }),
          { onConflict: "student_id,year,month" },
        ));
      }
      if (upErr) {
        return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
      }
    }

    const monthSubmittedByStudentId: Record<string, number> = {};
    const monthSubmittedLessonCountByStudentId: Record<string, number> = {};
    if (Number.isFinite(targetMonth) && targetMonth >= 1 && targetMonth <= 12) {
      for (const row of upserts) {
        if (row.month !== targetMonth) continue;
        monthSubmittedByStudentId[row.student_id] =
          (monthSubmittedByStudentId[row.student_id] ?? 0) + row.submitted_amount;
        if (row.submitted_lesson_count != null && row.submitted_lesson_count > 0) {
          monthSubmittedLessonCountByStudentId[row.student_id] =
            (monthSubmittedLessonCountByStudentId[row.student_id] ?? 0) + row.submitted_lesson_count;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      syncWindow: { dateStart, dateEnd },
      fetchedReceipts: receipts.length,
      syncedRows: upserts.length,
      unmatchedReceipts,
      debug: {
        matchedReceipts: matchedReceipts.length,
        totalLineItems,
        parsedMonthLineItems,
        skippedZeroQuantity,
        skippedNonCourseLineItems,
        detailFetchPreDiscount,
        zohoMatchedKeys: zohoMatchedKeys.size,
        zohoMissingNetKeys: zohoMissingNetKeys.size,
        tierAmountSamples: upserts.slice(0, 5).map((row) => {
          const lessons = row.submitted_lesson_count ?? 0;
          return `${row.student_id}:${row.month}:${lessons}堂=$${row.submitted_amount}`;
        }),
        detailCalls,
        skippedDetailByLimit,
        detailFetchSuccess,
        detailFetchEmpty,
        detailFetchError,
        detailErrorSamples,
      },
      unmatchedExamples: receipts
        .filter((r) => !matchStudentIdFromReceipt(r, studentIdSet, byName, idOnly, narrowStudents))
        .slice(0, 5)
        .map((r) =>
          String(
            r.company_name
              ? `${r.customer_name || r.customer_name_formatted || ""} (${r.company_name})`
              : r.customer_name_formatted || r.customer_name || r.customer_id || "",
          ),
        ),
      monthSubmittedByStudentId,
      monthSubmittedLessonCountByStudentId,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("ZOHO_RATE_LIMIT_EXCEEDED")) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Zoho API 今日配額已到上限（1000）。請稍後再試，或等配額重置後重試同步。",
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
