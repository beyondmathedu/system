import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const rows = [
  ["00259", "姜心悅", "Jiang Xinyue", "Cathy", "2009年4月4日", "65854291", "jiangxinyue05@gmail.com", "福建中學", "中五", "中文"],
  ["00260", "吳芍嬈", "Ng Cheuk Yiu Jessie", "Jessie", "2009年3月8日", "93615634", "ngjessie876@gmail.com", "嘉諾撒聖家書院", "中五", "英文"],
  ["00261", "潘予澄", "Pun Yu Ching Letitia", "Letitia", "2009年3月27日", "55415715", "letitiapun327@gmail.com", "真光女書院", "中五", "英文"],
  ["00262", "鄺念祈", "Kwong Niki", "Niki", "2013年1月12日", "63861236", "shirleymscheung@yahoo.com.hk", "聖瑪加利男女英文中小學", "中一", "英文"],
  ["00263", "王詩敏", "Wong Sze Man", "Emily", "2008年10月29日", "68432860", "wjkk78967@gmail.com", "中華傳道會安柱中學", "中四", "英文"],
  ["00264", "王穎妍", "Wong Wing Yin", "Wincy", "2009年9月28日", "68000606", "wincywwy928@gmail.com", "Fukien Secondary School", "中五", "英文"],
  ["00265", "王偉霖", "", "William", "2009年9月26日", "54446566", "william92632@gmail.com", "何文田官立中學", "中五", "英文"],
  ["00266", "李偉榮", "LEE WAI WING", "Darren", "2009年2月11日", "62818737", "s202111639@hmtgss.edu.hk", "何文田官立中學", "中五", "英文"],
  ["00267", "张晋茹", "Alice", "", "2008年11月13日", "67643721", "jinru2008@163.com", "香岛中学", "中五", "英文"],
  ["00268", "鄭美淳", "Cheng Mei Shun", "Macy", "2009年2月21日", "94866795", "dearmaicy@gmail.com", "Stmc", "中五", "英文"],
  ["00269", "吳芷翹", "Tszkiu Ng", "Tsz", "2009年8月21日", "55107884", "tszkiung0821@gmail.com", "CCHPWSS", "中五", "中文"],
  ["00270", "王梓彤", "Wang Zi Tong", "Nora", "2008年10月18日", "93496177", "chux48471@gmail.com", "保良局姚連生中學", "中五", "中文"],
  ["00271", "楊詩琪", "Yang Shi Qi", "Rachel", "2008年10月24日", "94869858", "quuuyasii@gmail.com", "CCCMKC", "中五", "英文"],
  ["00272", "賴穎儀", "Carina", "Carina", "2009年7月20日", "69572115", "s210044@takoi.edu.hk", "Toss", "中五", "英文"],
  ["00273", "黃溱蕎", "Wong Tsun Kiu", "Valerie", "2011年8月26日", "97923145", "kiwi_lingling@hotmail.com", "救恩書院", "中三", "英文"],
  ["00274", "蔡依彤", "Tsai Yee Tung", "Angel", "2008年12月18日", "53775579", "yeetungtsai@gmail.com", "香港培道中學", "中五", "英文"],
  ["00275", "曾熙融", "Tsang Hei Yung Praotes", "Praotes", "2010年6月10日", "95414929", "praotes0610@gmail.com", "Stewards Pooi Kei Collage", "中四", "英文"],
  ["00276", "陳哲", "ChenZhe", "Danny", "2010年1月29日", "91345137", "dannychen069@gmail.com", "Plk83", "中四", "英文"],
  ["00277", "邱曉晴", "Yau Hiu Ching", "Minnie", "2009年8月3日", "55482163", "1128minnieyau@gmail.com", "香港培道中學", "中五", "英文"],
  ["00278", "張穎菲", "cheung wing fei", "Jessica", "2008年12月10日", "67395343", "cheungwingfei@gmail.com", "福建中學", "中五", "中文"],
  ["00279", "梁沚殷", "Leung Chi Yan", "Hilary", "2012年8月12日", "92196812", "lok1031@gmail.com", "德望學校", "中二", "英文"],
  ["00280", "陳潼橦", "Annie Chan", "Annie", "2009年2月9日", "53057557", "annnniechan209@gmail.com", "福建中學", "中五", "中文"],
  ["00281", "賴焯𤋮", "Lai cheuk hei", "Alvin", "2009年10月26日", "91599846", "alvinhei0910@gmail.com", "FLSS", "中五", "英文"],
  ["00282", "蘇展燊", "Kyle So", "Kyle", "2009年11月20日", "97372477", "kyleso1120@gmail.com", "FLSS", "中五", "英文"],
  ["00283", "劉雅婷", "Lau Nga Ting", "Carrie", "2012年5月30日", "96384990", "simonkslau@gmail.com", "九龍真光中學", "中二", "英文"],
  ["00284", "莫凱善", "Mok Hoi Sin", "Cindy", "2010年1月17日", "55781827", "cmsundae@gmail.com", "香港培道中學", "中四", "英文"],
  ["00285", "龍巧瑜", "Long Qiao Yu", "Mavis", "2010年11月7日", "51686032", "mavislong2323@gmail.com", "PooiToMiddleSchool", "中四", "英文"],
  ["00286", "林緯琪", "vicky", "緯琪", "2007年9月10日", "66575555", "waikilin777@gmail.com", "福建中學", "中五", "中文"],
];

function toIsoDate(input) {
  const m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(String(input).trim());
  if (!m) return null;
  const y = m[1];
  const mo = String(Number(m[2])).padStart(2, "0");
  const d = String(Number(m[3])).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function toGrade(input) {
  const m = /^中([一二三四五六])$/.exec(String(input).trim());
  if (!m) return null;
  const map = { 一: "F1", 二: "F2", 三: "F3", 四: "F4", 五: "F5", 六: "F6" };
  return map[m[1]] ?? null;
}

function toMathLanguage(input) {
  const s = String(input).trim();
  if (s === "中文") return "Chinese";
  if (s === "英文") return "English";
  return null;
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

const { error } = await supabase.from("students").upsert(payload, { onConflict: "id" });
if (error) {
  console.error("Upsert failed:", error.message);
  process.exit(1);
}

console.log(`Upserted ${payload.length} students (00259-00286).`);
