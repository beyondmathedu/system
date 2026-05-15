import { NextResponse } from "next/server";
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
type StudentNameRow = { id: string; name_zh: string | null; name_en: string | null; nickname_en: string | null };
type ExistingFeeRow = {
  student_id: string;
  year: number;
  month: number;
  remarks: string | null;
  makeup_remarks: string | null;
  balance_due_remarks: string | null;
  send_fee: boolean | null;
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

/** Zoho Books 行常見：quantity＝堂數、item_total／rate 先至係港幣；舊碼用 quantity 當 submitted 會變成「5 堂＝$5」。 */
function lineItemSubmittedAmountHkd(li: Record<string, unknown>): number {
  const n = (v: unknown): number => {
    if (v == null) return NaN;
    if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
    const x = parseFloat(String(v).replace(/,/g, ""));
    return Number.isFinite(x) ? x : NaN;
  };
  const positiveTotals = [
    n(li.item_total),
    n(li.line_total),
    n(li.bcy_line_total),
    n(li.bcy_item_total),
    n(li.item_sub_total),
    n(li.amount),
  ].filter((x) => Number.isFinite(x) && x > 0);
  if (positiveTotals.length > 0) {
    return Math.round(Math.max(...positiveTotals) * 100) / 100;
  }

  const qty = n(li.quantity);
  const rates = [
    n(li.rate),
    n(li.price),
    n(li.unit_price),
    n(li.selling_price),
    n(li.bcy_rate),
  ].filter((x) => Number.isFinite(x) && x > 0);
  const rate = rates.length > 0 ? Math.max(...rates) : NaN;
  if (Number.isFinite(qty) && qty > 0 && Number.isFinite(rate) && rate > 0) {
    return Math.round(qty * rate * 100) / 100;
  }

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

function buildSyncWindow(year: number, month: number): { dateStart: string; dateEnd: string } {
  const base = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 2, 0));
  return { dateStart: toIsoYmdUtc(start), dateEnd: toIsoYmdUtc(end) };
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
    let studentsQuery = admin
      .from("students")
      .select("id, name_zh, name_en, nickname_en");
    if (requestedStudentIds && requestedStudentIds.length > 0) {
      studentsQuery = studentsQuery.in("id", requestedStudentIds);
    }
    const { data: students, error: stErr } = await studentsQuery.returns<StudentNameRow[]>();
    if (stErr) {
      return NextResponse.json({ ok: false, error: stErr.message }, { status: 500 });
    }

    const byName = new Map<string, string>();
    const studentIdSet = new Set<string>();
    for (const s of students ?? []) {
      const id = String(s.id ?? "").trim();
      if (!id) continue;
      studentIdSet.add(id);
      if (idOnly) continue;
      const zh = String(s.name_zh ?? "").trim();
      const en = String(s.name_en ?? "").trim();
      const nick = String(s.nickname_en ?? "").trim();
      const variants = [id, zh, en, nick, `${zh} ${en}`, `${zh} ${nick}`, `${zh}${en}`, `${zh}${nick}`];
      for (const v of variants) {
        const key = normalizeName(v);
        if (key) byName.set(key, id);
      }
    }

    const accessToken = await getZohoAccessToken();
    const { dateStart, dateEnd } = buildSyncWindow(year, targetMonth);
    const receipts = await fetchAllReceipts(accessToken, orgId, dateStart, dateEnd);
    const maxDetailCalls = 300;
    let detailCalls = 0;
    let skippedDetailByLimit = 0;
    let detailFetchSuccess = 0;
    let detailFetchEmpty = 0;
    let detailFetchError = 0;
    const detailErrorSamples: string[] = [];

    const amountByStudentMonth = new Map<string, number>();
    let unmatchedReceipts = 0;
    let parsedMonthLineItems = 0;
    let totalLineItems = 0;

    const matchedReceipts: Array<{ receipt: ZohoSalesReceipt; studentId: string }> = [];
    for (const r of receipts) {
      const billToCode = extractBillToCode(String(r.company_name ?? ""));
      const byBillTo = billToCode ? studentIdFromBillToCode(billToCode, studentIdSet) : null;
      const customerName = idOnly ? "" : normalizeName(String(r.customer_name ?? ""));
      const byCustomerName = idOnly ? null : byName.get(customerName) ?? null;
      const studentId = byBillTo || byCustomerName;
      if (!studentId) {
        unmatchedReceipts += 1;
        continue;
      }
      matchedReceipts.push({ receipt: r, studentId });
    }

    const withItems = await mapWithConcurrency(matchedReceipts, 8, async ({ receipt, studentId }) => {
      let lineItems = pickLineItems(receipt);
      const receiptId = String(receipt.sales_receipt_id ?? receipt.salesreceipt_id ?? "").trim();
      if ((!lineItems || lineItems.length === 0) && receiptId) {
        if (detailCalls >= maxDetailCalls) {
          skippedDetailByLimit += 1;
        } else {
          detailCalls += 1;
          const detail = await fetchReceiptDetail(accessToken, orgId, receiptId);
          if (detail.receipt) {
            detailFetchSuccess += 1;
            lineItems = pickLineItems(detail.receipt);
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
      return { studentId, lineItems };
    });

    for (const { studentId, lineItems } of withItems) {
      for (const li of lineItems) {
        totalLineItems += 1;
        const text = [
          li.item_name,
          li.name,
          li.description,
          // 某些 Zoho org 把月份放在其他 custom 欄位，直接掃整個 line item 最穩。
          JSON.stringify(li),
        ]
          .map((x) => String(x ?? "").trim())
          .join(" ");
        const month = monthFromText(text);
        if (!month) continue;
        parsedMonthLineItems += 1;
        const lineAmt = lineItemSubmittedAmountHkd(li as Record<string, unknown>);
        if (lineAmt <= 0) continue;
        const key = `${studentId}:${month}`;
        amountByStudentMonth.set(key, (amountByStudentMonth.get(key) ?? 0) + lineAmt);
      }
    }

    const studentIds = Array.from(new Set(Array.from(amountByStudentMonth.keys()).map((k) => k.split(":")[0])));
    const { data: existing } = studentIds.length
      ? await admin
          .from("student_monthly_fee_records")
          .select(
            "student_id, year, month, remarks, makeup_remarks, balance_due_remarks, send_fee, lesson_unit_price, fee_pricing_grade",
          )
          .eq("year", year)
          .in("student_id", studentIds)
          .returns<ExistingFeeRow[]>()
      : { data: [] as ExistingFeeRow[] };

    const existingMap = new Map<
      string,
      {
        remarks: string;
        makeup_remarks: string;
        balance_due_remarks: string;
        send_fee: boolean;
        lesson_unit_price: number | null;
        fee_pricing_grade: string | null;
      }
    >();
    for (const row of existing ?? []) {
      const sid = String(row.student_id ?? "");
      const mo = Number(row.month ?? 0);
      if (!sid || !mo) continue;
      existingMap.set(`${sid}:${mo}`, {
        remarks: String(row.remarks ?? ""),
        makeup_remarks: String(row.makeup_remarks ?? ""),
        balance_due_remarks: String(row.balance_due_remarks ?? ""),
        send_fee: Boolean(row.send_fee),
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
      remarks: string;
      makeup_remarks: string;
      balance_due_remarks: string;
      send_fee: boolean;
      lesson_unit_price: number | null;
      fee_pricing_grade: string | null;
    }> = [];
    for (const [key, amt] of amountByStudentMonth) {
      const [student_id, mStr] = key.split(":");
      const month = Number(mStr);
      const ex = existingMap.get(key);
      upserts.push({
        student_id,
        year,
        month,
        submitted_amount: Math.round(amt * 100) / 100,
        remarks: ex?.remarks ?? "",
        makeup_remarks: ex?.makeup_remarks ?? "",
        balance_due_remarks: ex?.balance_due_remarks ?? "",
        send_fee: ex?.send_fee ?? false,
        lesson_unit_price: ex?.lesson_unit_price ?? null,
        fee_pricing_grade: ex?.fee_pricing_grade ?? null,
      });
    }

    if (upserts.length > 0) {
      const { error: upErr } = await admin
        .from("student_monthly_fee_records")
        .upsert(upserts, { onConflict: "student_id,year,month" });
      if (upErr) {
        return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
      }
    }

    const monthSubmittedByStudentId: Record<string, number> = {};
    if (Number.isFinite(targetMonth) && targetMonth >= 1 && targetMonth <= 12) {
      for (const [key, amt] of amountByStudentMonth) {
        const [sid, mStr] = key.split(":");
        if (Number(mStr) !== targetMonth) continue;
        monthSubmittedByStudentId[sid] = (monthSubmittedByStudentId[sid] ?? 0) + amt;
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
        detailCalls,
        skippedDetailByLimit,
        detailFetchSuccess,
        detailFetchEmpty,
        detailFetchError,
        detailErrorSamples,
      },
      unmatchedExamples: receipts
        .filter((r) => {
          const billToCode = extractBillToCode(String(r.company_name ?? ""));
          const byBillTo = billToCode ? studentIdFromBillToCode(billToCode, studentIdSet) : null;
          if (idOnly) return !byBillTo;
          const keyA = normalizeName(String(r.customer_name ?? ""));
          const keyB = normalizeName(String(r.customer_name_formatted ?? ""));
          return !(byBillTo || byName.get(keyA) || byName.get(keyB));
        })
        .slice(0, 5)
        .map((r) =>
          String(
            r.company_name
              ? `${r.customer_name || r.customer_name_formatted || ""} (${r.company_name})`
              : r.customer_name_formatted || r.customer_name || r.customer_id || "",
          ),
        ),
      monthSubmittedByStudentId,
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
