/**
 * Audit student contact numbers before bulk portal provisioning.
 *   npx tsx scripts/audit-student-contact-numbers.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { normalizeStudentId } from "../src/lib/studentId";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Row = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  email: string | null;
  student_phone: string | null;
};

function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

async function main() {
  const { data, error } = await sb
    .from("students")
    .select("id, name_zh, name_en, email, student_phone")
    .order("id");
  if (error) throw error;

  const rows = (data ?? []) as Row[];
  const byLen = new Map<number, number>();
  const byDigitLen = new Map<number, number>();
  const over8: Array<{
    id: string;
    name: string;
    phone: string;
    digits: string;
    digitLen: number;
  }> = [];
  const noPhone: Array<{ id: string; name: string; email: string }> = [];
  const shortPw: Array<{ id: string; name: string; phone: string; digits: string }> = [];

  for (const r of rows) {
    const phone = String(r.student_phone ?? "").trim();
    const digits = digitsOnly(phone);
    byLen.set(phone.length, (byLen.get(phone.length) ?? 0) + 1);
    if (digits) byDigitLen.set(digits.length, (byDigitLen.get(digits.length) ?? 0) + 1);
    const name = [r.name_zh, r.name_en].filter(Boolean).join(" / ");
    if (!phone) {
      noPhone.push({ id: r.id, name, email: String(r.email ?? "") });
      continue;
    }
    if (digits.length > 8) {
      over8.push({ id: r.id, name, phone, digits, digitLen: digits.length });
    }
    const pw = phone.length >= 6 ? phone : digits.length >= 6 ? digits : "";
    if (!pw) shortPw.push({ id: r.id, name, phone, digits });
  }

  const emailMap = new Map<string, string[]>();
  for (const r of rows) {
    const email = String(r.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const sid = normalizeStudentId(r.id);
    const list = emailMap.get(email) ?? [];
    list.push(sid);
    emailMap.set(email, list);
  }
  const dupes = [...emailMap.entries()].filter(([, ids]) => ids.length > 1);

  console.log("=== CONTACT NUMBER SUMMARY ===");
  console.log("Total students:", rows.length);
  console.log("No contact number:", noPhone.length);
  console.log("Password too short (<6):", shortPw.length);
  console.log("Digit length > 8:", over8.length);
  console.log("");
  console.log("Raw string length (incl spaces/symbols):");
  [...byLen.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([len, c]) => console.log(`  ${len} chars: ${c}`));
  console.log("");
  console.log("Digits-only length:");
  [...byDigitLen.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([len, c]) => console.log(`  ${len} digits: ${c}`));

  console.log("\n=== DUPLICATE EMAILS ===");
  if (dupes.length === 0) console.log("(none)");
  for (const [email, ids] of dupes) {
    console.log(`${email} -> ${ids.join(", ")}`);
    for (const id of ids) {
      const r = rows.find((x) => normalizeStudentId(x.id) === id)!;
      console.log(
        `   ${id} ${r.name_zh ?? ""} ${r.name_en ?? ""} | phone: ${r.student_phone ?? "—"}`,
      );
    }
  }

  console.log("\n=== CONTACT NUMBERS WITH >8 DIGITS ===");
  for (const x of over8) {
    console.log(
      `${x.id} ${x.name} | stored: ${JSON.stringify(x.phone)} | digits: ${x.digits} (${x.digitLen})`,
    );
  }

  if (shortPw.length > 0) {
    console.log("\n=== TOO SHORT FOR PASSWORD ===");
    for (const x of shortPw) {
      console.log(`${x.id} ${x.name} | stored: ${JSON.stringify(x.phone)} | digits: ${x.digits}`);
    }
  }

  mkdirSync("scripts/output", { recursive: true });
  const csv = [
    "student_id,name,email,student_phone,digits_only,digit_length,pw_issue",
    ...rows.map((r) => {
      const phone = String(r.student_phone ?? "").trim();
      const digits = digitsOnly(phone);
      const name = [r.name_zh, r.name_en].filter(Boolean).join(" / ").replace(/"/g, '""');
      let issue = "";
      if (!phone) issue = "no_phone";
      else if (phone.length < 6 && digits.length < 6) issue = "password_too_short";
      else if (digits.length > 8) issue = "digits_over_8";
      return [
        normalizeStudentId(r.id),
        `"${name}"`,
        String(r.email ?? ""),
        `"${phone.replace(/"/g, '""')}"`,
        digits,
        digits.length,
        issue,
      ].join(",");
    }),
  ].join("\n");
  writeFileSync("scripts/output/contact-number-audit.csv", csv);
  console.log("\nFull audit CSV: scripts/output/contact-number-audit.csv");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
