/**
 * Audit all students: for each month in 2026 (from system start),
 * verify inactive gap logic matches what the lessons page should show.
 * Usage: node scripts/check-all-months-inactive-prompt.mjs
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
const FIRST_MONTH = 5; // LESSON_SYSTEM_START_MONTH
const MONTHS = Array.from({ length: 12 - FIRST_MONTH + 1 }, (_, i) => FIRST_MONTH + i);

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

function isDateInactive({ periods, studentId, grade, year, dateIso }) {
  const merged = withAutoF6InactivePeriod({ periods, studentId, grade, year });
  for (const p of merged) {
    if (dateIso < p.startDate) continue;
    if (p.endDate && dateIso >= p.endDate) continue;
    return true;
  }
  return false;
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
  const pushGroup = () => gaps.push({ months: [...group] });
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

function monthHasPartialInactive({ periods, studentId, grade, year, month }) {
  const monthStart = monthStartIso(year, month);
  const monthEndExclusive = firstDayOfNextMonthIso(year, month);
  const fullyInactive = isIsoRangeFullyInactive({
    periods: withAutoF6InactivePeriod({ periods, studentId, grade, year }),
    startIso: monthStart,
    endExclusiveIso: monthEndExclusive,
  });
  if (fullyInactive) return false;

  // Walk each day in month (sample: check if any day inactive AND any day active)
  let hasInactive = false;
  let hasActive = false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (isDateInactive({ periods, studentId, grade, year, dateIso: iso })) hasInactive = true;
    else hasActive = true;
    if (hasInactive && hasActive) return true;
  }
  return false;
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
  if (periodsErr && !periodsErr.message.toLowerCase().includes("student_visibility_periods")) throw periodsErr;

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

  const monthLabels = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Per-month counts
  const fullPromptByMonth = Object.fromEntries(MONTHS.map((m) => [m, []]));
  const partialByMonth = Object.fromEntries(MONTHS.map((m) => [m, []]));
  const activeByMonth = Object.fromEntries(MONTHS.map((m) => [m, 0]));

  const studentSummaries = [];

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
    const fullMonths = new Set(gaps.flatMap((g) => g.months));
    const partialMonths = [];
    const activeMonths = [];

    for (const m of MONTHS) {
      if (fullMonths.has(m)) {
        fullPromptByMonth[m].push(sid);
      } else if (monthHasPartialInactive({ periods, studentId: sid, grade: s.grade, year: YEAR, month: m })) {
        partialByMonth[m].push(sid);
        partialMonths.push(m);
      } else {
        activeByMonth[m]++;
        activeMonths.push(m);
      }
    }

    if (periods.length > 0 || isF6Grade(s.grade)) {
      studentSummaries.push({
        id: sid,
        grade: s.grade ?? "",
        periods: periods.length,
        fullMonths: [...fullMonths].sort((a, b) => a - b),
        partialMonths,
        gapRanges: gaps.map((g) => g.months.map((m) => monthLabels[m]).join("-")).join(", ") || "—",
      });
    }
  }

  const total = students?.length ?? 0;
  console.log(`\n=== ${YEAR} inactive logic audit (${total} students, months ${FIRST_MONTH}–12) ===\n`);

  console.log("Month | Full inactive (gap prompt) | Partial inactive (some days hidden) | Active (normal lessons)");
  console.log("------|---------------------------|-----------------------------------|----------------------");
  for (const m of MONTHS) {
    const full = fullPromptByMonth[m].length;
    const partial = partialByMonth[m].length;
    const active = activeByMonth[m];
    console.log(
      `${monthLabels[m].padEnd(5)} | ${String(full).padStart(25)} | ${String(partial).padStart(35)} | ${String(active).padStart(20)}`,
    );
  }

  console.log(`\n--- Students with manual inactive periods: ${studentSummaries.filter((s) => s.periods > 0).length} ---`);
  for (const s of studentSummaries.filter((s) => s.periods > 0).slice(0, 40)) {
    console.log(
      `  ${s.id}  grade=${s.grade}  periods=${s.periods}  full=[${s.fullMonths.map((m) => monthLabels[m]).join(",")}]  partial=[${s.partialMonths.map((m) => monthLabels[m]).join(",")}]`,
    );
  }
  const manualCount = studentSummaries.filter((s) => s.periods > 0).length;
  if (manualCount > 40) console.log(`  ... and ${manualCount - 40} more`);

  console.log(`\n--- F.6 auto inactive (74 expected) ---`);
  const f6 = studentSummaries.filter((s) => isF6Grade(s.grade));
  console.log(`  Count: ${f6.length}, all have May full inactive: ${f6.every((s) => s.fullMonths.includes(5)) ? "YES" : "NO"}`);

  // Sanity: full + partial + active should equal total each month
  console.log(`\n--- Sanity check (full + partial + active = ${total}) ---`);
  for (const m of MONTHS) {
    const sum = fullPromptByMonth[m].length + partialByMonth[m].length + activeByMonth[m];
    const ok = sum === total ? "✓" : `✗ got ${sum}`;
    if (sum !== total) console.log(`  ${monthLabels[m]}: ${ok}`);
  }
  console.log("  All months balance: " + (MONTHS.every((m) => fullPromptByMonth[m].length + partialByMonth[m].length + activeByMonth[m] === total) ? "YES" : "NO"));

  // Spot checks
  console.log(`\n--- Spot checks ---`);
  for (const id of ["00060", "00056", "00265"]) {
    const s = studentSummaries.find((x) => x.id === id);
    if (!s) {
      console.log(`  ${id}: not in summary (no periods, not F6)`);
      continue;
    }
    console.log(
      `  ${id}: full=[${s.fullMonths.map((m) => monthLabels[m]).join(",")}] partial=[${s.partialMonths.map((m) => monthLabels[m]).join(",")}] gaps=${s.gapRanges}`,
    );
  }

  // Common partial pattern (5/28 start)
  const may28Partial = partialByMonth[5].filter((id) => {
    const ps = periodsById.get(id) ?? [];
    return ps.some((p) => p.startDate === "2026-05-28");
  });
  console.log(`\n--- May partial inactive starting 5/28: ${may28Partial.length} students ---`);
  console.log(`  IDs: ${may28Partial.slice(0, 15).join(", ")}${may28Partial.length > 15 ? ` ... +${may28Partial.length - 15}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
