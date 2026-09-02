/**
 * Audit fee-record inactive logic: current grade vs inferred grade at sheet month.
 * Usage: npx tsx scripts/audit-fee-grade-inference.mjs [year] [month]
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

const year = Number(process.argv[2] ?? "2026");
const month = Number(process.argv[3] ?? "7");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { isStudentHiddenForFeeSheetMonthFromPeriods, buildStudentInactivePeriodsById } =
  await import("../src/lib/studentVisibility.ts");
const { inferGradeAtSheetEnd } = await import("../src/lib/studentFeePricingGrade.ts");

const { data: visRows } = await supabase
  .from("student_visibility_periods")
  .select("student_id,start_date,end_date,note");
const periodsById = buildStudentInactivePeriodsById(visRows ?? []);
const { data: students } = await supabase.from("students").select("id,grade,name_zh").order("id");

const changed = [];
for (const st of students ?? []) {
  const id = String(st.id);
  const periods = periodsById[id] ?? [];
  const oldHidden = isStudentHiddenForFeeSheetMonthFromPeriods({
    periods,
    studentId: id,
    grade: st.grade,
    sheetYear: year,
    sheetMonth: month,
  });
  const inferred = inferGradeAtSheetEnd(st.grade ?? "", year, month);
  const newHidden = isStudentHiddenForFeeSheetMonthFromPeriods({
    periods,
    studentId: id,
    grade: inferred,
    sheetYear: year,
    sheetMonth: month,
  });
  if (oldHidden !== newHidden) {
    changed.push({
      id,
      name: st.name_zh,
      currentGrade: st.grade,
      inferredGrade: inferred,
      wasHidden: oldHidden,
      nowHidden: newHidden,
    });
  }
}

console.log(`Fee sheet ${year}-${String(month).padStart(2, "0")}: ${students?.length ?? 0} students total`);
console.log(`Students with changed inactive result: ${changed.length}`);
for (const c of changed) {
  console.log(
    `${c.id} ${c.name}: ${c.currentGrade}→${c.inferredGrade} at month-end, hidden ${c.wasHidden}→${c.nowHidden}`,
  );
}
