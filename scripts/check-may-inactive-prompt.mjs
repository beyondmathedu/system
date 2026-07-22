/**
 * Check all students: May 2026 should show inactive gap prompt when fully inactive.
 * Usage: node scripts/check-may-inactive-prompt.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const p = resolve(process.cwd(), ".env.local");
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const m = /^([^#=]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

loadEnv();

const YEAR = 2026;
const MONTH = 5;
const FIRST_MONTH = 5; // LESSON_SYSTEM_START_MONTH for 2026

function monthStartIso(year, month) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function firstDayOfNextMonthIso(year, month) {
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function normalizeOptionalIsoDate(raw) {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isF6Grade(grade) {
  return /^F\.?6$/i.test(String(grade ?? "").trim().replace(/\s/g, ""));
}

function sortAndCoalescePeriods(periods) {
  const normalized = periods
    .map((p) => ({
      studentId: String(p.studentId ?? "").trim(),
      startDate: String(p.startDate ?? "").trim(),
      endDate: normalizeOptionalIsoDate(p.endDate),
      note: p.note,
    }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.startDate));
  normalized.sort((a, b) => {
    const sd = a.startDate.localeCompare(b.startDate);
    if (sd !== 0) return sd;
    const ea = a.endDate ?? "9999-12-31";
    const eb = b.endDate ?? "9999-12-31";
    return ea.localeCompare(eb);
  });
  const out = [];
  for (const p of normalized) {
    const last = out[out.length - 1];
    if (!last) {
      out.push({ ...p });
      continue;
    }
    if (last.studentId !== p.studentId) {
      out.push({ ...p });
      continue;
    }
    const lastEndComparable = last.endDate ?? "9999-12-31";
    if (p.startDate <= lastEndComparable) {
      last.endDate = last.endDate == null || p.endDate == null ? null : p.endDate > last.endDate ? p.endDate : last.endDate;
      continue;
    }
    out.push({ ...p });
  }
  return out;
}

function withAutoF6InactivePeriod({ periods, studentId, grade, year }) {
  const auto = isF6Grade(grade)
    ? { studentId, startDate: `${year}-05-01`, endDate: null, note: "auto: F6 graduation" }
    : null;
  return sortAndCoalescePeriods(auto ? [...periods, auto] : [...periods]);
}

function isIsoRangeFullyInactive({ periods, startIso, endExclusiveIso }) {
  const coalesced = sortAndCoalescePeriods([...periods]);
  const relevant = coalesced.filter((p) => {
    const pEnd = p.endDate ?? "9999-12-31";
    return p.startDate < endExclusiveIso && pEnd > startIso;
  });
  if (!relevant.length) return false;
  let cursor = startIso;
  for (const p of relevant) {
    const pEnd = p.endDate ?? "9999-12-31";
    if (pEnd <= cursor) continue;
    if (p.startDate > cursor) return false;
    cursor = pEnd;
    if (cursor >= endExclusiveIso) return true;
  }
  return cursor >= endExclusiveIso;
}

function getInactiveMonthGapsInYearFromPeriods({ periods, studentId, grade, year, firstMonth = 1 }) {
  const merged = withAutoF6InactivePeriod({ periods, studentId, grade, year });
  if (!merged.length) return [];
  const fullyInactive = [];
  for (let m = firstMonth; m <= 12; m++) {
    const monthStart = monthStartIso(year, m);
    const monthEndExclusive = firstDayOfNextMonthIso(year, m);
    if (isIsoRangeFullyInactive({ periods: merged, startIso: monthStart, endExclusiveIso: monthEndExclusive })) {
      fullyInactive.push(m);
    }
  }
  if (!fullyInactive.length) return [];
  const gaps = [];
  let group = [fullyInactive[0]];
  const pushGroup = () => {
    gaps.push({ months: [...group] });
  };
  for (let i = 1; i < fullyInactive.length; i++) {
    const month = fullyInactive[i];
    if (month === group[group.length - 1] + 1) {
      group.push(month);
      continue;
    }
    pushGroup();
    group = [month];
  }
  pushGroup();
  return gaps;
}

function mayShowsInactivePrompt(gaps) {
  return gaps.some((g) => g.months.includes(MONTH));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const [{ data: students, error: studentsErr }, { data: periodRows, error: periodsErr }] = await Promise.all([
    supabase.from("students").select("id, name_zh, name_en, grade").order("id"),
    supabase.from("student_visibility_periods").select("student_id, start_date, end_date, note").order("start_date"),
  ]);

  if (studentsErr) throw studentsErr;
  if (periodsErr) {
    const msg = periodsErr.message.toLowerCase();
    if (!msg.includes("student_visibility_periods")) throw periodsErr;
  }

  const periodsById = new Map();
  for (const row of periodRows ?? []) {
    const sid = String(row.student_id ?? "").trim();
    if (!sid) continue;
    const start = normalizeOptionalIsoDate(row.start_date);
    if (!start) continue;
    const list = periodsById.get(sid) ?? [];
    list.push({
      studentId: sid,
      startDate: start,
      endDate: normalizeOptionalIsoDate(row.end_date),
      note: String(row.note ?? ""),
    });
    periodsById.set(sid, list);
  }

  const shouldPrompt = [];
  const shouldNotPrompt = [];
  const f6AutoMay = [];

  for (const s of students ?? []) {
    const sid = String(s.id ?? "").trim();
    const periods = periodsById.get(sid) ?? [];
    const gaps = getInactiveMonthGapsInYearFromPeriods({
      periods,
      studentId: sid,
      grade: s.grade,
      year: YEAR,
      firstMonth: FIRST_MONTH,
    });
    const prompt = mayShowsInactivePrompt(gaps);
    const name = [s.name_zh, s.name_en].filter(Boolean).join(" / ") || sid;
    const entry = { id: sid, name, grade: s.grade ?? "", periods: periods.length, gaps: gaps.map((g) => g.months.join("-")).join(", ") || "—" };

    if (isF6Grade(s.grade)) f6AutoMay.push(entry);
    if (prompt) shouldPrompt.push(entry);
    else shouldNotPrompt.push(entry);
  }

  console.log(`\n=== May ${YEAR} inactive prompt check (${students?.length ?? 0} students) ===\n`);
  console.log(`Should show May inactive prompt: ${shouldPrompt.length}`);
  for (const e of shouldPrompt) {
    console.log(`  ${e.id}  ${e.name}  grade=${e.grade}  periods=${e.periods}  gaps=${e.gaps}`);
  }

  console.log(`\nShould NOT show May inactive prompt: ${shouldNotPrompt.length}`);
  if (shouldNotPrompt.length <= 30) {
    for (const e of shouldNotPrompt) {
      console.log(`  ${e.id}  ${e.name}  grade=${e.grade}`);
    }
  } else {
    console.log(`  (listing first 15)`);
    for (const e of shouldNotPrompt.slice(0, 15)) {
      console.log(`  ${e.id}  ${e.name}  grade=${e.grade}`);
    }
    console.log(`  ... and ${shouldNotPrompt.length - 15} more`);
  }

  console.log(`\nF.6 students (auto inactive from May 1): ${f6AutoMay.length}`);
  for (const e of f6AutoMay) {
    const inPrompt = shouldPrompt.some((p) => p.id === e.id);
    console.log(`  ${e.id}  ${e.name}  mayPrompt=${inPrompt ? "YES" : "NO"}`);
  }

  const f6Missing = f6AutoMay.filter((e) => !shouldPrompt.some((p) => p.id === e.id));
  if (f6Missing.length) {
    console.log(`\n⚠ F.6 without May prompt: ${f6Missing.map((e) => e.id).join(", ")}`);
  } else {
    console.log(`\n✓ All F.6 students get May inactive prompt`);
  }

  const targetIds = ["00060", "00056"];
  console.log(`\nSpot check:`);
  for (const id of targetIds) {
    const e = shouldPrompt.find((p) => p.id === id) ?? shouldNotPrompt.find((p) => p.id === id);
    if (!e) {
      console.log(`  ${id}: not found`);
      continue;
    }
    const prompt = shouldPrompt.some((p) => p.id === id);
    console.log(`  ${id}: mayPrompt=${prompt ? "YES" : "NO"}  grade=${e.grade}  gaps=${e.gaps ?? "—"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
