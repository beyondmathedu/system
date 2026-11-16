/**
 * Find + optionally fix student-months where submitted is exactly 2× 應繳.
 * Usage:
 *   npx tsx scripts/fix-zoho-paid-doubles.mjs [year] [monthFrom] [monthTo] [--apply]
 */
import { readFileSync } from "node:fs";
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

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const nums = args.filter((a) => a !== "--apply").map(Number);
const year = Number.isFinite(nums[0]) ? nums[0] : 2026;
const monthFrom = Number.isFinite(nums[1]) ? nums[1] : 5;
const monthTo = Number.isFinite(nums[2]) ? nums[2] : 12;

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

    // Still include hidden students: Excel / Balance Due can still show overpayment.
    const hidden = isStudentHiddenForFeeSheetMonthFromPeriods({
      periods,
      studentId: sid,
      grade: student.grade,
      sheetYear: year,
      sheetMonth: m,
    });

    const dates = collectBillableLessonDatesForMonth({
      records,
      state,
      year,
      month1to12: m,
      legacyWeekdays: [],
      isDateInactive,
    });
    const dueLessons = dates.length;
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

    const amountExactDouble = Math.abs(paid - due * 2) < 0.51;
    const lessonsDoubled =
      paidLessons != null && dueLessons > 0 && paidLessons === dueLessons * 2;
    if (!amountExactDouble) continue;

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
      hidden,
    });
  }
}

doubles.sort((a, b) => a.month - b.month || a.student_id.localeCompare(b.student_id));

console.log(
  JSON.stringify(
    {
      year,
      monthFrom,
      monthTo,
      apply,
      exact_double_count: doubles.length,
      lessons_also_doubled: doubles.filter((d) => d.lessons_doubled).length,
      hidden_count: doubles.filter((d) => d.hidden).length,
    },
    null,
    2,
  ),
);

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
    hidden: d.hidden,
  })),
);

if (!apply) {
  console.log("\nDry run only. Re-run with --apply to write half paid/lessons.");
  process.exit(0);
}

const now = new Date().toISOString();
let ok = 0;
for (const d of doubles) {
  const { error } = await supabase.from("student_monthly_fee_records").upsert(
    {
      student_id: d.student_id,
      year,
      month: d.month,
      submitted_amount: d.half_paid,
      submitted_lesson_count: d.half_lessons,
      updated_at: now,
    },
    { onConflict: "student_id,year,month" },
  );
  if (error) {
    console.error("fail", d.student_id, d.month, error.message);
  } else {
    ok += 1;
  }
}
console.log(`applied ${ok}/${doubles.length}`);
