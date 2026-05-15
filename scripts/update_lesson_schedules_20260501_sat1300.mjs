/**
 * 批量新增 2026-05-01 生效的星期六 1:00 PM 课表记录（追加，不覆盖）。
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
const WEEKDAY = "六";
const TIME = "01:00 PM";

const GROUPS = [
  {
    room: "Hope 1",
    students: [
      { nameZh: "賴柏然", nick: "Leo" },
      { nameZh: "黃淨慈", nick: "Anna" },
      { nameZh: "陳昊鋒", nick: "Sunny" },
      { nameZh: "溫祉維", nick: "Wesley" },
      { nameZh: "吳敏華", nick: "Yoyo" },
    ],
  },
  {
    room: "B",
    students: [
      { nameZh: "衛芷翹", nick: "Alpha" },
      { nameZh: "王穎妍", nick: "Wincy" },
      { nameZh: "陳志遠", nick: "Aiden" },
    ],
  },
  {
    room: "M前",
    students: [
      { nameZh: "何芊楠", nick: "Chloris" },
      { nameZh: "徐寶兒", nick: "Bowie" },
      { nameZh: "王詩敏", nick: "Emily" },
      { nameZh: "何柏葵", nick: "Peggy" },
    ],
  },
  {
    room: "M後",
    students: [
      { nameZh: "胡森惠", nick: "Charice" },
      { nameZh: "馬啟朗", nick: "Gordon" },
      { nameZh: "馬沛彤", nick: "Kaitly" },
      { nameZh: "石濬僖", nick: "Cyrus" },
    ],
  },
];

function normZh(s) {
  return String(s ?? "")
    .replace(/\s/g, "")
    .replace(/張/g, "张")
    .replace(/陳/g, "陈")
    .replace(/黃/g, "黄")
    .replace(/賴/g, "赖")
    .replace(/柏/g, "柏")
    .replace(/然/g, "然")
    .replace(/淨/g, "净")
    .replace(/慈/g, "慈")
    .replace(/昊/g, "昊")
    .replace(/鋒/g, "锋")
    .replace(/溫/g, "温")
    .replace(/祉/g, "祉")
    .replace(/維/g, "维")
    .replace(/吳/g, "吴")
    .replace(/敏/g, "敏")
    .replace(/華/g, "华")
    .replace(/衛/g, "卫")
    .replace(/芷/g, "芷")
    .replace(/翹/g, "翘")
    .replace(/王/g, "王")
    .replace(/穎/g, "颖")
    .replace(/妍/g, "妍")
    .replace(/志/g, "志")
    .replace(/遠/g, "远")
    .replace(/何/g, "何")
    .replace(/芊/g, "芊")
    .replace(/楠/g, "楠")
    .replace(/徐/g, "徐")
    .replace(/寶/g, "宝")
    .replace(/兒/g, "儿")
    .replace(/詩/g, "诗")
    .replace(/葵/g, "葵")
    .replace(/胡/g, "胡")
    .replace(/森/g, "森")
    .replace(/惠/g, "惠")
    .replace(/馬/g, "马")
    .replace(/啟/g, "启")
    .replace(/朗/g, "朗")
    .replace(/沛/g, "沛")
    .replace(/彤/g, "彤")
    .replace(/石/g, "石")
    .replace(/濬/g, "浚")
    .replace(/僖/g, "僖")
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
const ambiguous = [];

let seq = 0;

for (const group of GROUPS) {
  for (const spec of group.students) {
    const zh = normZh(spec.nameZh);
    const nick = normEn(spec.nick);
    const matches = (students ?? []).filter((s) => {
      const sZh = normZh(s.name_zh);
      if (sZh && zh && (sZh === zh || sZh.includes(zh) || zh.includes(sZh))) return true;
      const sNick = normEn(s.nickname_en);
      const sEn = normEn(s.name_en);
      if (nick && sNick === nick) return true;
      if (nick && sEn === nick) return true;
      if (nick && sEn.includes(nick)) return true;
      if (nick && sNick.includes(nick)) return true;
      return false;
    });

    if (matches.length > 1 && !matches.find((s) => normZh(s.name_zh) === zh)) {
      ambiguous.push({
        spec,
        room: group.room,
        ids: matches.map((m) => `${m.id} ${m.name_zh}/${m.nickname_en}`),
      });
    }

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
      id: `bulk-20260501-sat1300-${student.id}-${++seq}`,
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

console.log("\n=== 已新增课表 (2026-05-01 星期六 1:00 PM) ===\n");
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

if (ambiguous.length) {
  console.log("=== 匹配到多名学生（已取第一个），请核对 ===\n");
  for (const a of ambiguous) {
    console.log(`  ${a.spec.nameZh} (${a.spec.nick ?? "—"})  →  ${a.room}: ${a.ids.join("; ")}`);
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
