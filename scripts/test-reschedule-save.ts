import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { saveLessonYearStatePatch } from "../src/lib/studentLessonStorage";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const sid = process.argv[2] ?? "00002";
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: state } = await sb
    .from("student_lessons_year_state")
    .select("*")
    .eq("student_id", sid)
    .eq("year", 2026)
    .single();

  const entries = [...((state?.reschedule_entries as unknown[]) ?? [])];
  console.log("current reschedule count", entries.length);

  for (const field of ["rescheduleEntries", "overrides", "hiddenDates", "extraEntries"] as const) {
    try {
      const patch =
        field === "rescheduleEntries"
          ? { rescheduleEntries: entries }
          : field === "overrides"
            ? { overrides: (state?.overrides as Record<string, unknown>) ?? {} }
            : field === "hiddenDates"
              ? { hiddenDates: (state?.hidden_dates as Record<string, boolean>) ?? {} }
              : { extraEntries: (state?.extra_entries as unknown[]) ?? [] };
      await saveLessonYearStatePatch(sid, 2026, patch, [field], {
        skipScheduleCacheRevalidate: true,
      });
      console.log(`save ${field}: OK`);
    } catch (e) {
      console.error(`save ${field} FAILED:`, e instanceof Error ? e.message : e);
    }
  }
}

void main();
