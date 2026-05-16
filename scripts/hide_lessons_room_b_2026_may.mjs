/**
 * 隱藏 Room B、03:00 PM 的指定課堂（2026 年 5 月）。
 * 等同於在課表勾選隱藏該日 — 寫入 hidden_dates，並移除同日 B 房加堂／調堂至該日的記錄。
 *
 * 用法：node scripts/hide_lessons_room_b_2026_may.mjs
 * 需要 .env.local 內 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
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
const TARGET_ROOM = "B";
const TARGET_TIME = "03:00 PM";

/** student_id → ISO dates to hide (from screenshots) */
const HIDES_BY_STUDENT = {
  "00011": ["2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25"],
  "00013": ["2026-05-04", "2026-05-13", "2026-05-20", "2026-05-27"],
  "00058": ["2026-05-04", "2026-05-13", "2026-05-20", "2026-05-27"],
  "00192": ["2026-05-13", "2026-05-20", "2026-05-27"],
};

function normRoom(r) {
  return String(r ?? "").trim();
}

function normTime(t) {
  return String(t ?? "").trim().replace(/\s+/g, " ");
}

function matchesTargetSlot(entry) {
  return normRoom(entry.room) === TARGET_ROOM && normTime(entry.time) === TARGET_TIME;
}

function parseState(row) {
  return {
    attendance:
      row?.attendance && typeof row.attendance === "object"
        ? { ...row.attendance }
        : {},
    hiddenDates:
      row?.hidden_dates && typeof row.hidden_dates === "object"
        ? { ...row.hidden_dates }
        : {},
    overrides:
      row?.overrides && typeof row.overrides === "object" ? { ...row.overrides } : {},
    rescheduleEntries: Array.isArray(row?.reschedule_entries) ? [...row.reschedule_entries] : [],
    extraEntries: Array.isArray(row?.extra_entries) ? [...row.extra_entries] : [],
  };
}

function applyHides(state, dateSet) {
  const beforeHidden = Object.keys(state.hiddenDates).length;
  const beforeExtra = state.extraEntries.length;
  const beforeReschedule = state.rescheduleEntries.length;

  for (const iso of dateSet) {
    state.hiddenDates[iso] = true;
    delete state.attendance[iso];
    delete state.overrides[iso];
  }

  state.extraEntries = state.extraEntries.filter((ex) => {
    const d = String(ex?.date ?? "").slice(0, 10);
    if (!dateSet.has(d)) return true;
    return !matchesTargetSlot(ex);
  });

  state.rescheduleEntries = state.rescheduleEntries.filter((e) => {
    const to = String(e?.toDate ?? "").slice(0, 10);
    const from = String(e?.fromDate ?? "").slice(0, 10);
    if (dateSet.has(to) && matchesTargetSlot(e)) return false;
    if (dateSet.has(from)) {
      delete state.attendance[`cancelled:${from}:${e.id}`];
      delete state.attendance[`reschedule:${e.id}`];
    }
    return true;
  });

  for (const iso of dateSet) {
    for (const key of Object.keys(state.attendance)) {
      if (key === iso || key.startsWith(`${iso}:`) || key.includes(`:${iso}:`)) {
        delete state.attendance[key];
      }
    }
  }

  return {
    hiddenAdded: Object.keys(state.hiddenDates).length - beforeHidden,
    extraRemoved: beforeExtra - state.extraEntries.length,
    rescheduleRemoved: beforeReschedule - state.rescheduleEntries.length,
  };
}

function toDbPayload(studentId, state) {
  return {
    student_id: studentId,
    attendance: state.attendance,
    hidden_dates: state.hiddenDates,
    overrides: state.overrides,
    reschedule_entries: state.rescheduleEntries,
    extra_entries: state.extraEntries,
    updated_at: new Date().toISOString(),
  };
}

async function loadLegacyState(studentId) {
  const { data, error } = await supabase
    .from("student_lessons_2026_state")
    .select("attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw new Error(`legacy load ${studentId}: ${error.message}`);
  return data;
}

async function loadYearState(studentId) {
  const { data, error } = await supabase
    .from("student_lessons_year_state")
    .select("attendance, hidden_dates, overrides, reschedule_entries, extra_entries")
    .eq("student_id", studentId)
    .eq("year", YEAR)
    .maybeSingle();
  if (error) throw new Error(`year load ${studentId}: ${error.message}`);
  return data;
}

async function upsertLegacy(studentId, state) {
  const { error } = await supabase.from("student_lessons_2026_state").upsert(
    toDbPayload(studentId, state),
    { onConflict: "student_id" },
  );
  if (error) throw new Error(`legacy upsert ${studentId}: ${error.message}`);
}

async function upsertYear(studentId, state) {
  const { error } = await supabase.from("student_lessons_year_state").upsert(
    { ...toDbPayload(studentId, state), year: YEAR },
    { onConflict: "student_id,year" },
  );
  if (error) throw new Error(`year upsert ${studentId}: ${error.message}`);
}

console.log(`\n=== Hide Room ${TARGET_ROOM} @ ${TARGET_TIME} (${YEAR} May) ===\n`);

for (const [studentId, dates] of Object.entries(HIDES_BY_STUDENT)) {
  const dateSet = new Set(dates);
  const legacyRow = await loadLegacyState(studentId);
  const yearRow = await loadYearState(studentId);

  const legacyState = parseState(legacyRow ?? {});
  const yearState = parseState(yearRow ?? {});

  const legacyStats = applyHides(legacyState, dateSet);
  const yearStats = applyHides(yearState, dateSet);

  await upsertLegacy(studentId, legacyState);
  await upsertYear(studentId, yearState);

  console.log(
    `  ${studentId}: hidden ${dates.join(", ")} | legacy +${legacyStats.hiddenAdded} hidden, -${legacyStats.extraRemoved} extra, -${legacyStats.rescheduleRemoved} reschedule | year +${yearStats.hiddenAdded} hidden`,
  );
}

console.log("\nDone. Refresh room schedule to confirm rows are gone.\n");
