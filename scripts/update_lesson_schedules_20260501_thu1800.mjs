/**
 * 批量新增 2026-05-01 生效的星期四 6:00 课表记录（追加，不覆盖）。
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
const WEEKDAY = "四";
const TIME = "06:00 PM";

const GROUPS = [
  {
    room: "B",
    students: [
      { nameZh: "楊詩琪", nick: "Rachel" },
      { nameZh: "蔡依彤", nick: "Angel" },
      { nameZh: "邱曉晴", nick: "Minnie" },
    ],
  },
  {
    room: "M前",
    students: [
      { nameZh: "聶以晴", nick: "Zoe" },
      { nameZh: "孔博姿", nick: "Hailey" },
      { nameZh: "黃天蔚", nick: "Hollie" },
      { nameZh: "謝穎淇", nick: "Nora" },
    ],
  },
];

function normZh(s) {
  return String(s ?? "")
    .replace(/\s/g, "")
    .replace(/楊/g, "杨")
    .replace(/詩/g, "诗")
    .replace(/琪/g, "琪")
    .replace(/蔡/g, "蔡")
    .replace(/依/g, "依")
    .replace(/彤/g, "彤")
    .replace(/邱/g, "邱")
    .replace(/曉/g, "晓")
    .replace(/晴/g, "晴")
    .replace(/聶/g, "聂")
    .replace(/以/g, "以")
    .replace(/孔/g, "孔")
    .replace(/博/g, "博")
    .replace(/姿/g, "姿")
    .replace(/黃/g, "黄")
    .replace(/天/g, "天")
    .replace(/蔚/g, "蔚")
    .replace(/謝/g, "谢")
    .replace(/穎/g, "颖")
    .replace(/淇/g, "淇")
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
      id: `bulk-20260501-thu1800-${student.id}-${++seq}`,
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

console.log("\n=== 已新增课表 (2026-05-01 星期四 6:00 PM) ===\n");
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
