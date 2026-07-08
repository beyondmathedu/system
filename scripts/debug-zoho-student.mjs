/**
 * Debug Zoho receipts for one student ID. Usage:
 *   node scripts/debug-zoho-student.mjs 00265 2026 7
 */
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  const p = resolve(process.cwd(), ".env.local");
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const m = /^([^#=]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

loadEnv();

const studentId = process.argv[2] ?? "00265";
const year = Number(process.argv[3] ?? 2026);
const month = Number(process.argv[4] ?? 7);

const MONTH_MAP = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function parseZohoNumber(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const x = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : NaN;
}

function extractBillToCode(raw) {
  const m = String(raw ?? "").match(/\b(\d{2,6})\b/);
  return m ? m[1] : null;
}

function studentIdFromBillToCode(code, set) {
  const raw = String(Math.trunc(Number(code)));
  for (const c of [raw.padStart(5, "0"), raw.padStart(4, "0"), raw.padStart(3, "0"), raw]) {
    if (set.has(c)) return c;
  }
  return null;
}

function isTuitionLineItem(li) {
  const text = [li.item_name, li.name, li.description].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ").toLowerCase();
  if (text.includes("math course")) return true;
  return /\bf\.?\s*[1-6]\b/.test(text);
}

function monthFromText(text) {
  const t = text.toLowerCase();
  const zh = /([1-9]|1[0-2])\s*月/.exec(t);
  if (zh) return Number(zh[1]);
  const en = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.exec(t);
  if (!en) return null;
  return MONTH_MAP[en[1].toLowerCase()] ?? null;
}

async function getToken() {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  });
  const resp = await fetch("https://accounts.zoho.com/oauth/v2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await resp.json();
  if (!json.access_token) throw new Error(JSON.stringify(json));
  return json.access_token;
}

async function main() {
  const token = await getToken();
  const orgId = process.env.ZOHO_ORG_ID;
  const base = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 2, 0));
  const dateStart = start.toISOString().slice(0, 10);
  const dateEnd = end.toISOString().slice(0, 10);
  const set = new Set([studentId]);

  const listUrl = `https://www.zohoapis.com/books/v3/salesreceipts?organization_id=${orgId}&date_start=${dateStart}&date_end=${dateEnd}&per_page=200`;
  const listResp = await fetch(listUrl, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const listJson = await listResp.json();
  const receipts = listJson.salesreceipts ?? listJson.sales_receipts ?? [];

  const matched = [];
  for (const r of receipts) {
    let sid = null;
    for (const field of [r.company_name, r.customer_name, r.customer_name_formatted]) {
      const code = extractBillToCode(String(field ?? ""));
      if (code) sid = studentIdFromBillToCode(code, set);
      if (sid) break;
    }
    if (sid) matched.push(r);
  }

  console.log(`Student ${studentId} year=${year} month=${month} window=${dateStart}..${dateEnd}`);
  console.log(`Total receipts in window: ${receipts.length}, matched: ${matched.length}`);

  for (const r of matched) {
    const id = r.salesreceipt_id ?? r.sales_receipt_id;
    console.log("\n--- LIST receipt ---");
    console.log({
      id,
      date: r.date,
      customer_name: r.customer_name,
      customer_name_formatted: r.customer_name_formatted,
      company_name: r.company_name,
      total: r.total,
      line_items: (r.line_items ?? r.lineitems ?? []).map((li) => ({
        name: li.name ?? li.item_name,
        description: li.description,
        qty: li.quantity,
        rate: li.rate,
        item_total: li.item_total,
        amount: li.amount,
        tuition: isTuitionLineItem(li),
        month: monthFromText([li.item_name, li.name, li.description, JSON.stringify(li)].join(" ")),
      })),
    });

    const detailUrl = `https://www.zohoapis.com/books/v3/salesreceipts/${id}?organization_id=${orgId}`;
    const detailResp = await fetch(detailUrl, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const detailJson = await detailResp.json();
    const dr = detailJson.salesreceipt ?? detailJson.sales_receipt ?? detailJson.sales_receipt_details;
    if (dr) {
      console.log("\n--- DETAIL receipt ---");
      console.log({
        total: dr.total,
        sub_total: dr.sub_total,
        discount: dr.discount,
        discount_total: dr.discount_total,
        line_items: (dr.line_items ?? dr.lineitems ?? []).map((li) => ({
          name: li.name ?? li.item_name,
          description: li.description,
          qty: li.quantity,
          rate: li.rate,
          item_total: li.item_total,
          amount: li.amount,
          discount: li.discount,
          discount_amount: li.discount_amount,
          tuition: isTuitionLineItem(li),
          month: monthFromText([li.item_name, li.name, li.description, JSON.stringify(li)].join(" ")),
        })),
      });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
