import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const sid = process.argv[2] ?? "00116";
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const [{ data: rec }, { data: state }] = await Promise.all([
    sb.from("student_lesson_records").select("records").eq("student_id", sid).single(),
    sb.from("student_lessons_year_state").select("*").eq("student_id", sid).eq("year", 2026).single(),
  ]);
  console.log("RECORDS:", JSON.stringify(rec?.records, null, 2));
  console.log("OVERRIDES:", JSON.stringify(state?.overrides, null, 2));
  console.log("RESCHEDULE:", JSON.stringify(state?.reschedule_entries, null, 2));
  console.log("EXTRA:", JSON.stringify(state?.extra_entries, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
