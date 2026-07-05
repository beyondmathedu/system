import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

function loadEnvLocal() {
  const out = {};
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = loadEnvLocal();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in .env.local");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const rows = [
  ["00307", "王頌雯", "Pinkie Wong", "Pinkie", "", "54003779", "pinkie1220wong@gmail.com", "聖保祿學校", "中五", "英文"],
  ["00308", "謝若嵐", "Tse Yeuk Laam", "Kari", "2013年12月9日", "69262900", "happy.pucca@hotmail.com", "Methodist college (mckln)循道中學", "中一", "英文"],
  ["00309", "黃梓安", "Huang Tsz On Angela", "Angela", "2010年11月29日", "65737743", "rico_hk@yahoo.com", "聖母玫瑰書院", "中三", "英文"],
  ["00310", "賈功弦", "Kar Kung In Travis", "Travis", "", "68422729", "fiona_ctl@yahoo.com.hk", "黃棣珊中學", "中一", "英文"],
  ["00311", "林朝輝", "Lam Chiu Fai", "Leon", "2009年4月3日", "63165881", "janice6906@gmail.com", "觀塘官立中學", "中四", ""],
  ["00312", "谢甄彤", "Tse Yan Tung", "Hilary", "2012年9月14日", "70712789", "yichak@gmail.com", "青年會書院", "中二", "英文"],
  ["00313", "鄧文懿", "Jade Tang", "Jade", "2009年7月10日", "95637050", "jadetang0710@gmail.com", "Hep Yunn School", "中五", "英文"],
  ["00314", "譚凱玹", "Tam Hoi Yuen", "Candy", "2009年6月21日", "68702331", "candytam2106@gmail.com", "cccmkc", "中五", "英文"],
  ["00315", "陳億芯", "Chan Yik Sum", "Sanny", "2012年4月22日", "69186463", "selselwong@gmail.com", "王肇枝中學", "中二", "英文"],
  ["00316", "李煦澄", "Li Hui Ching", "Haleigh", "2012年11月16日", "69976334", "heholmetro@hotmail.com", "南亞路德會沐恩中學（大埔）", "中二", "英文"],
];

function toIsoDate(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (!m) return null;
  const y = m[1];
  const mo = String(Number(m[2])).padStart(2, "0");
  const d = String(Number(m[3])).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function toGrade(input) {
  const m = /^中([一二三四五六])$/.exec(String(input ?? "").trim());
  if (!m) return null;
  const map = { 一: "F1", 二: "F2", 三: "F3", 四: "F4", 五: "F5", 六: "F6" };
  return map[m[1]] ?? null;
}

function toMathLanguage(input) {
  const s = String(input ?? "").trim();
  if (!s) return "English";
  if (s === "中文") return "Chinese";
  if (s === "英文") return "English";
  return s;
}

const payload = rows.map((r) => {
  const [id, nameZh, nameEn, nicknameEn, birthDateRaw, phone, email, school, gradeRaw, langRaw] = r;
  return {
    id: String(id).trim(),
    name_zh: String(nameZh).trim() || null,
    name_en: String(nameEn).trim() || null,
    nickname_en: String(nicknameEn).trim() || null,
    birth_date: toIsoDate(birthDateRaw),
    student_phone: String(phone).trim() || null,
    email: String(email).trim() || null,
    school: String(school).trim() || null,
    grade: toGrade(gradeRaw),
    math_language: toMathLanguage(langRaw),
  };
});

const { data: existing, error: checkErr } = await supabase
  .from("students")
  .select("id")
  .in(
    "id",
    payload.map((p) => p.id),
  );
if (checkErr) {
  console.error("Check failed:", checkErr.message);
  process.exit(1);
}
if (existing?.length) {
  console.error("IDs already exist:", existing.map((r) => r.id).join(", "));
  process.exit(1);
}

const { error } = await supabase.from("students").upsert(payload, { onConflict: "id" });
if (error) {
  console.error("Upsert failed:", error.message);
  process.exit(1);
}

console.log("Upserted students:");
for (const p of payload) {
  console.log(`${p.id}\t${p.name_zh}\t${p.name_en}`);
}
