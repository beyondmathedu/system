/**
 * Find student-months where submitted (已繳) is exactly 2× monthly 應繳.
 * Usage: npx tsx scripts/audit-zoho-paid-doubles.mjs [year] [monthFrom] [monthTo]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq <= 0) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (!process.env[k]) process.env[k] = v;
      }
    } catch {
      /* optional */
    }
  }
}

loadEnv();

const year = Number(process.argv[2] ?? 2026);
const monthFrom = Number(process.argv[3] ?? 5);
const monthTo = Number(process.argv[4] ?? 12);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

const { loadFeeRecordBootstrap } = await import("../src/lib/lessonDataServer.ts");
const {
  collectBillableLessonDatesForMonth,
  normalizeFeeLessonRecords,
  toYearLessonStateFromClient,
} = await import("../src/lib/feeRecordLessonDates.ts");
const countDatedLessonSlots = (dates) => dates.length;
const {
  makeStudentInactiveDateCheckerFromPeriods,
  isStudentHiddenForFeeSheetMonthFromPeriods,
} = await import("../src/lib/studentVisibility.ts");
const { gradeForFeePricing, sumSlotTuitionHkdFromDates } = await import(
  "../src/lib/studentFeePricingGrade.ts"
);
const { resolveFeeTierSettingsForStudent } = await import("../src/lib/studentFeeTierSettings.ts");

const boot = await loadFeeRecordBootstrap(supabase, {
  sheetYear: year,
  sheetMonth: monthTo,
});

const feeByStudentMonth = new Map();
for (const row of boot.feeRows ?? []) {
  const sid = String(row.student_id ?? "");
  const m = Number(row.month);
  if (!sid || !m) continue;
  feeByStudentMonth.set(`${sid}:${m}`, row);
}

const doubles = [];
const nearDoubles = [];

for (const student of boot.students) {
  const sid = student.id;
  const records = normalizeFeeLessonRecords(boot.recordsMap[sid] ?? []);
  const state = toYearLessonStateFromClient(boot.yearStatesMap[sid]);
  const periods = boot.visibilityByStudentId[sid]?.periods ?? [];
  const heldBack = boot.heldBackYearsResult?.byStudentId?.[sid] ?? null;
  const gradeHistory = boot.gradeHistoryResult?.byStudentId?.[sid] ?? null;
  const isDateInactive = makeStudentInactiveDateCheckerFromPeriods({
    periods,
    studentId: sid,
    grade: student.grade,
    year,
    heldBackYears: heldBack,
    historyByAcademicYear: gradeHistory,
  });

  for (let m = monthFrom; m <= monthTo; m += 1) {
    const feeRow = feeByStudentMonth.get(`${sid}:${m}`);
    const paid = Number(feeRow?.submitted_amount ?? 0) || 0;
    const paidLessonsRaw = feeRow?.submitted_lesson_count;
    const paidLessons =
      paidLessonsRaw == null || Number.isNaN(Number(paidLessonsRaw))
        ? null
        : Number(paidLessonsRaw);

    if (paid <= 0.005) continue;

    if (
      isStudentHiddenForFeeSheetMonthFromPeriods({
        periods,
        studentId: sid,
        grade: student.grade,
        sheetYear: year,
        sheetMonth: m,
      })
    ) {
      continue;
    }

    const dates = collectBillableLessonDatesForMonth({
      records,
      state,
      year,
      month1to12: m,
      legacyWeekdays: [],
      isDateInactive,
    });
    const dueLessons = countDatedLessonSlots(dates);
    const gradeFor = gradeForFeePricing(
      student.grade,
      year,
      m,
      String(feeRow?.fee_pricing_grade ?? ""),
      heldBack,
      gradeHistory,
    );
    const tier = resolveFeeTierSettingsForStudent(boot.feeTierBundle, sid, year, m);
    const due = sumSlotTuitionHkdFromDates({
      fullLessonDates: dates,
      gradeFor,
      feeTierSettings: tier,
    });

    if (due <= 0.005) continue;

    const ratio = paid / due;
    const lessonsDoubled =
      paidLessons != null && dueLessons > 0 && paidLessons === dueLessons * 2;
    const amountExactDouble = Math.abs(paid - due * 2) < 0.51;

    if (amountExactDouble) {
      doubles.push({
        student_id: sid,
        name: `${student.name_zh || ""} ${student.name_en || student.nickname_en || ""}`.trim(),
        grade: student.grade,
        month: m,
        due,
        due_lessons: dueLessons,
        paid,
        paid_lessons: paidLessons,
        lessons_doubled: lessonsDoubled,
        half_paid: Math.round((paid / 2) * 100) / 100,
        half_lessons: paidLessons != null ? paidLessons / 2 : dueLessons,
      });
    } else if (ratio > 1.85 && ratio < 2.15) {
      nearDoubles.push({
        student_id: sid,
        month: m,
        due,
        paid,
        ratio: Math.round(ratio * 1000) / 1000,
        due_lessons: dueLessons,
        paid_lessons: paidLessons,
      });
    }
  }
}

doubles.sort((a, b) => a.month - b.month || a.student_id.localeCompare(b.student_id));

const byMonth = new Map();
for (const row of doubles) {
  byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + 1);
}

console.log(
  JSON.stringify(
    {
      year,
      monthFrom,
      monthTo,
      exact_double_count: doubles.length,
      by_month: Object.fromEntries([...byMonth.entries()].sort((a, b) => a[0] - b[0])),
      near_double_count: nearDoubles.length,
      lessons_also_doubled: doubles.filter((d) => d.lessons_doubled).length,
    },
    null,
    2,
  ),
);

const outPath = `scripts/audit-zoho-paid-doubles-${year}.json`;
writeFileSync(outPath, JSON.stringify({ summary: { exact_double_count: doubles.length, byMonth: Object.fromEntries(byMonth) }, doubles, nearDoubles }, null, 2));
console.log(`wrote ${outPath}`);

console.log("\n=== Exact 2× 應繳 (paid ≈ 2 × due) ===");
console.table(
  doubles.map((d) => ({
    id: d.student_id,
    name: d.name.slice(0, 18),
    m: d.month,
    due: d.due,
    paid: d.paid,
    dueL: d.due_lessons,
    paidL: d.paid_lessons,
    Lx2: d.lessons_doubled,
  })),
);

if (nearDoubles.length) {
  console.log("\n=== Near 2× (ratio 1.85–2.15, not exact) ===");
  console.table(nearDoubles.slice(0, 40));
}
