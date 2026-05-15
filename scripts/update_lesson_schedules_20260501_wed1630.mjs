/**
 * 批量新增 2026-05-01 生效的星期三 4:30 课表记录（追加，不覆盖）。
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
const WEEKDAY = "三";
const TIME = "04:30 PM";

const GROUPS = [
  {
    room: "Hope 1",
    students: [
      { nameZh: "陳心予", nick: "Sum Yu" },
      { nameZh: "何以晴", nick: "Elise" },
      { nameZh: "林緯琪", nick: "Vicky" },
    ],
  },
  {
    room: "B",
    students: [
      { nameZh: "張紫澄", nick: "Lia" },
      { nameZh: "吳卓琦", nick: "Kelly" },
      { nameZh: "何焯傑", nick: "Elvin" },
    ],
  },
  {
    room: "M前",
    students: [
      { nameZh: "劉鈺盈", nick: "Flora" },
      { nameZh: "梁詠琛" },
      { nameZh: "鄭巧瑤" },
      { nameZh: "張熙蘊" },
    ],
  },
];

function normZh(s) {
  return String(s ?? "")
    .replace(/\s/g, "")
    .replace(/張/g, "张")
    .replace(/陳/g, "陈")
    .replace(/劉/g, "刘")
    .replace(/鄭/g, "郑")
    .replace(/吳/g, "吴")
    .replace(/何/g, "何")
    .replace(/梁/g, "梁")
    .replace(/鈺/g, "钰")
    .replace(/詠/g, "咏")
    .replace(/瑤/g, "瑶")
    .replace(/蘊/g, "蕴")
    .replace(/緯/g, "纬")
    .replace(/琪/g, "琪")
    .toLowerCase();
}

function normEn(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function recordKey(rec) {
  return `${rec.effectiveDate ?? ""}|${rec.weekday}|${rec.time}|${rec.room}`;
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
    if (nick && sNick.includes(nick)) return true;
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
      id: `bulk-20260501-wed1630-${student.id}-${++seq}`,
      effectiveDate: EFFECTIVE_DATE,
      weekday: WEEKDAY,
      time: TIME,
      room: group.room,
      createdAt: Date.now() + seq,
    };

    if (existing.some((r) => recordKey(r) === recordKey(newRec))) {
      skippedDuplicate.push({
        id: student.id,
        name: [student.name_zh, student.nickname_en || student.name_en].filter(Boolean).join(" / "),
        room: group.room,
      });
      continue;
    }

    const { error: upErr } = await supabase.from("student_lesson_records").upsert(
      {
        student_id: student.id,
        records: [...existing, newRec],
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

console.log("\n=== 已新增课表 (2026-05-01 星期三 4:30 PM) ===\n");
for (const u of updated) {
  console.log(`  ${u.id}  ${u.name}  →  ${u.room}${u.hadPrior ? "  (原本已有记录，已追加)" : ""}`);
}
console.log(`\n共新增 ${updated.length} 笔。\n`);

if (hadRecordsBefore.length) {
  console.log("=== 以下学生原本已有 Lesson Schedule 记录（本次已追加）===\n");
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
  console.log("=== 找不到学生 ===\n");
  for (const n of notFound) {
    console.log(`  ${n.nameZh} (${n.nick ?? "—"})  →  ${n.room}`);
  }
  process.exitCode = 1;
}
