/**
 * 批量新增 2026-05-01 生效的星期二 4:30 课表记录（追加到现有 records，不覆盖）。
 * 运行：node scripts/update_lesson_schedules_20260501.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

loadEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const EFFECTIVE_DATE = "2026-05-01";
const WEEKDAY = "二";
const TIME = "04:30 PM";

/** @type {{ room: string; students: { nameZh: string; nick?: string; nameEn?: string }[] }[]} */
const GROUPS = [
  {
    room: "Hope 2",
    students: [
      { nameZh: "林易麟", nick: "Alan" },
      { nameZh: "林裕晟", nick: "Jason" },
    ],
  },
  {
    room: "Hope 1",
    students: [
      { nameZh: "林姵彤", nick: "Prudence" },
      { nameZh: "張晋茹", nick: "Alice", nameEn: "Alice" },
      { nameZh: "蕭暢昇", nick: "Franklin" },
    ],
  },
  {
    room: "B",
    students: [
      { nameZh: "廖樂同", nick: "Enoch" },
      { nameZh: "何倩瑩", nick: "Hadas" },
      { nameZh: "李惠嵐", nick: "Laam" },
    ],
  },
  {
    room: "M前",
    students: [
      { nameZh: "張竣皓", nick: "Jaden" },
      { nameZh: "余諾文", nick: "Farrah" },
      { nameZh: "林星妤", nick: "Sofia" },
      { nameZh: "謝子晴", nick: "Sofei" },
      { nameZh: "穆穎清", nick: "Chingching" },
      { nameZh: "穆穎淳", nick: "Shun Shun" },
    ],
  },
];

function normZh(s) {
  return String(s ?? "")
    .replace(/\s/g, "")
    .replace(/張/g, "张")
    .toLowerCase();
}

function normEn(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function recordKey(rec) {
  const ed = rec.effectiveDate ?? "";
  return `${ed}|${rec.weekday}|${rec.time}|${rec.room}`;
}

function findStudent(all, spec) {
  const zh = normZh(spec.nameZh);
  const nick = normEn(spec.nick);
  const nameEn = normEn(spec.nameEn ?? spec.nick);

  const matches = all.filter((s) => {
    const sZh = normZh(s.name_zh);
    if (sZh && zh && (sZh === zh || sZh.includes(zh) || zh.includes(sZh))) return true;
    const sNick = normEn(s.nickname_en);
    const sEn = normEn(s.name_en);
    if (nick && sNick === nick) return true;
    if (nick && sEn === nick) return true;
    if (nameEn && sEn === nameEn) return true;
    if (nick && sEn.includes(nick)) return true;
    return false;
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const exactZh = matches.find((s) => normZh(s.name_zh) === zh);
    if (exactZh) return exactZh;
    return matches[0];
  }
  return null;
}

const { data: students, error: stErr } = await supabase
  .from("students")
  .select("id, name_zh, name_en, nickname_en")
  .order("id");

if (stErr) {
  console.error("Failed to load students:", stErr.message);
  process.exit(1);
}

const hadRecordsBefore = [];
const updated = [];
const skippedDuplicate = [];
const notFound = [];
const ambiguous = [];

let seq = 0;

for (const group of GROUPS) {
  for (const spec of group.students) {
    const student = findStudent(students ?? [], spec);
    if (!student) {
      notFound.push({ ...spec, room: group.room });
      continue;
    }

    const { data: row, error: loadErr } = await supabase
      .from("student_lesson_records")
      .select("records")
      .eq("student_id", student.id)
      .maybeSingle();

    if (loadErr) {
      console.error(`Load records failed for ${student.id}:`, loadErr.message);
      process.exit(1);
    }

    const existing = Array.isArray(row?.records) ? [...row.records] : [];
    if (existing.length > 0) {
      hadRecordsBefore.push({
        id: student.id,
        name: [student.name_zh, student.nickname_en || student.name_en].filter(Boolean).join(" / "),
        count: existing.length,
        room: group.room,
      });
    }

    const newRec = {
      id: `bulk-20260501-${student.id}-${++seq}`,
      effectiveDate: EFFECTIVE_DATE,
      weekday: WEEKDAY,
      time: TIME,
      room: group.room,
      createdAt: Date.now() + seq,
    };

    const dup = existing.some((r) => recordKey(r) === recordKey(newRec));
    if (dup) {
      skippedDuplicate.push({
        id: student.id,
        name: [student.name_zh, student.nickname_en || student.name_en].filter(Boolean).join(" / "),
        room: group.room,
      });
      continue;
    }

    const merged = [...existing, newRec];
    const { error: upErr } = await supabase.from("student_lesson_records").upsert(
      {
        student_id: student.id,
        records: merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    );

    if (upErr) {
      console.error(`Upsert failed for ${student.id}:`, upErr.message);
      process.exit(1);
    }

    updated.push({
      id: student.id,
      name: [student.name_zh, student.nickname_en || student.name_en].filter(Boolean).join(" / "),
      room: group.room,
      hadPrior: existing.length > 0,
    });
  }
}

console.log("\n=== 已新增课表 (2026-05-01 星期二 4:30 PM) ===\n");
for (const u of updated) {
  console.log(
    `  ${u.id}  ${u.name}  →  ${u.room}${u.hadPrior ? "  (原本已有记录，已追加)" : ""}`,
  );
}
console.log(`\n共新增 ${updated.length} 笔。\n`);

if (hadRecordsBefore.length) {
  console.log("=== 以下学生原本已有 Lesson Schedule 记录（本次已追加新时段）===\n");
  for (const h of hadRecordsBefore) {
    console.log(`  ${h.id}  ${h.name}  (原有 ${h.count} 笔)  →  新加 ${h.room}`);
  }
  console.log("");
}

if (skippedDuplicate.length) {
  console.log("=== 已存在相同记录，跳过 ===\n");
  for (const s of skippedDuplicate) {
    console.log(`  ${s.id}  ${s.name}  →  ${s.room}`);
  }
  console.log("");
}

if (notFound.length) {
  console.log("=== 找不到学生，请手动核对姓名/ID ===\n");
  for (const n of notFound) {
    console.log(`  ${n.nameZh} (${n.nick ?? ""})  →  ${n.room}`);
  }
  console.log("");
  process.exitCode = 1;
}
