/**
 * 2026 年 5 月：按星期＋房間設定導師（所有時段）。
 * 以 effectiveDate 2026-05-01 套用新導師，2026-06-01 還原 4/30 當日生效的導師。
 *
 * node scripts/apply_may_2026_room_tutors.mjs
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

const YEAR = 2026;
const MAY_START = "2026-05-01";
const JUNE_REVERT = "2026-06-01";
const PRE_MAY = "2026-04-30";
const PATCH_ID_PREFIX = "may26-tutor-";

/** 星期 → 房間 → 導師 nickname（與 tutors 表一致） */
const TUTOR_BY_WEEKDAY_ROOM = {
  一: { "Hope 1": "Li", B: "Howard" },
  二: { "Hope 1": "Samuel", "Hope 2": "Li", B: "Kelly", M前: "Alex" },
  三: { "Hope 1": "Li", B: "Matthew", M前: "Howard" },
  四: { "Hope 1": "Li", B: "Samuel", M前: "Frank" },
  五: { "Hope 1": "Kelly", "Hope 2": "Li", B: "Samuel", M前: "Candy" },
};

function normalizeRoom(room) {
  const s = String(room ?? "").trim();
  if (s === "Hope") return "Hope 1";
  return s;
}

function toHkIsoFromMs(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function weekdayCnFromIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const map = { 0: "日", 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六" };
  return map[js] ?? "";
}

function normalizeRecord(item) {
  if (!item || typeof item !== "object") return null;
  const o = item;
  const weekday = String(o.weekday ?? "").trim();
  const room = String(o.room ?? "").trim();
  const time = String(o.time ?? "").trim();
  if (!weekday || !room) return null;
  const createdAt =
    typeof o.createdAt === "number" ? o.createdAt : Number(o.createdAt) > 0 ? Number(o.createdAt) : Date.now();
  return {
    id: typeof o.id === "string" ? o.id : undefined,
    effectiveDate: typeof o.effectiveDate === "string" ? o.effectiveDate : undefined,
    weekday,
    time,
    room,
    tutor: o.tutor != null ? String(o.tutor).trim() : "",
    lessonSummary: o.lessonSummary != null ? String(o.lessonSummary) : undefined,
    createdAt,
  };
}

function slotKey(r) {
  return `${r.weekday}|${r.time}|${normalizeRoom(r.room)}`;
}

function activeBySlotOnDate(records, dateIso) {
  const wd = weekdayCnFromIso(dateIso);
  const bySlot = new Map();
  for (const raw of records) {
    const r = normalizeRecord(raw);
    if (!r || r.weekday !== wd) continue;
    const eff = r.effectiveDate ?? toHkIsoFromMs(r.createdAt);
    if (eff > dateIso) continue;
    const key = slotKey(r);
    const prev = bySlot.get(key);
    const prevEff = prev ? (prev.effectiveDate ?? toHkIsoFromMs(prev.createdAt)) : "";
    if (!prev || eff > prevEff) bySlot.set(key, r);
  }
  return bySlot;
}

function mayDates() {
  const out = [];
  for (let d = 1; d <= 31; d++) {
    out.push(`2026-05-${String(d).padStart(2, "0")}`);
  }
  return out;
}

function targetTutor(weekday, room) {
  const norm = normalizeRoom(room);
  return TUTOR_BY_WEEKDAY_ROOM[weekday]?.[norm] ?? null;
}

function patchRecordsForStudent(studentId, rawRecords) {
  const records = Array.isArray(rawRecords) ? [...rawRecords] : [];
  const withoutPatch = records.filter((r) => !String(r?.id ?? "").startsWith(PATCH_ID_PREFIX));

  const slotsToPatch = new Map();

  for (const dateIso of mayDates()) {
    const active = activeBySlotOnDate(withoutPatch, dateIso);
    for (const [key, rec] of active) {
      const tutor = targetTutor(rec.weekday, rec.room);
      if (!tutor) continue;
      if (!slotsToPatch.has(key)) {
        const preMay = activeBySlotOnDate(withoutPatch, PRE_MAY).get(key) ?? rec;
        slotsToPatch.set(key, {
          template: rec,
          revertTutor: (preMay.tutor ?? rec.tutor ?? "").trim(),
          targetTutor: tutor,
        });
      }
    }
  }

  const added = [];
  for (const [key, { template, revertTutor, targetTutor: tgt }] of slotsToPatch) {
    const safeKey = key.replace(/[^a-zA-Z0-9|]/g, "_");
    withoutPatch.push({
      id: `${PATCH_ID_PREFIX}${studentId}-${safeKey}-0501`,
      effectiveDate: MAY_START,
      weekday: template.weekday,
      time: template.time,
      room: template.room,
      tutor: tgt,
      lessonSummary: template.lessonSummary,
      createdAt: Date.now(),
    });
    withoutPatch.push({
      id: `${PATCH_ID_PREFIX}${studentId}-${safeKey}-0601`,
      effectiveDate: JUNE_REVERT,
      weekday: template.weekday,
      time: template.time,
      room: template.room,
      tutor: revertTutor,
      lessonSummary: template.lessonSummary,
      createdAt: Date.now() + 1,
    });
    added.push({
      studentId,
      slot: key,
      mayTutor: tgt,
      juneRevertTutor: revertTutor || "(empty)",
    });
  }

  return { records: withoutPatch, added };
}

console.log("\n=== 2026 May room tutors (by weekday) ===\n");
for (const [wd, rooms] of Object.entries(TUTOR_BY_WEEKDAY_ROOM)) {
  console.log(`  星期${wd}: ${Object.entries(rooms).map(([r, t]) => `${r}→${t}`).join(", ")}`);
}
console.log("");

const { data: rows, error: loadErr } = await supabase
  .from("student_lesson_records")
  .select("student_id, records");

if (loadErr) {
  console.error("Load failed:", loadErr.message);
  process.exit(1);
}

let studentsUpdated = 0;
let slotsPatched = 0;
const samples = [];

for (const row of rows ?? []) {
  const studentId = String(row.student_id ?? "");
  if (!studentId) continue;
  const { records: next, added } = patchRecordsForStudent(studentId, row.records);
  if (added.length === 0) continue;

  const { error: upErr } = await supabase.from("student_lesson_records").upsert(
    {
      student_id: studentId,
      records: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );

  if (upErr) {
    console.error(`Upsert failed for ${studentId}:`, upErr.message);
    process.exit(1);
  }

  studentsUpdated += 1;
  slotsPatched += added.length;
  if (samples.length < 12) samples.push(...added.slice(0, 2));
}

console.log(`Updated ${studentsUpdated} students, ${slotsPatched} slot(s) (May + June revert rows each).\n`);
if (samples.length) {
  console.log("Sample:");
  for (const s of samples) {
    console.log(`  ${s.studentId}  ${s.slot}  May→${s.mayTutor}  Jun→${s.juneRevertTutor}`);
  }
  console.log("");
}
console.log("Done. Refresh Daily / Room timetable for May 2026.\n");
