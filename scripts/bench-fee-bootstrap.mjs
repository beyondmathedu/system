import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { loadFeeRecordBootstrap } = await import("../src/lib/lessonDataServer.ts");

async function t(label, fn) {
  const t0 = performance.now();
  await fn();
  console.log(`${label.padEnd(36)} ${Math.round(performance.now() - t0)} ms`);
}

console.log("Fee bootstrap x3 (cold-ish):");
for (let i = 1; i <= 3; i++) {
  await t(`  run ${i}`, () => loadFeeRecordBootstrap(sb, { sheetYear: 2026, sheetMonth: 11 }));
}
