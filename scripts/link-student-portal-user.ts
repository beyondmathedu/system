/**
 * Link an Auth email to a student portal account (role=student, read-only own lessons).
 *
 * Usage:
 *   npx tsx scripts/link-student-portal-user.ts eddiechanwk2016@gmail.com 00145
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { normalizeStudentId } from "../src/lib/studentId";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const email = String(process.argv[2] ?? "").trim().toLowerCase();
  const studentId = normalizeStudentId(String(process.argv[3] ?? ""));
  if (!email || !studentId) {
    console.error("Usage: npx tsx scripts/link-student-portal-user.ts <email> <studentId>");
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: student, error: studentError } = await sb
    .from("students")
    .select("id, name_zh, name_en, email")
    .eq("id", studentId)
    .maybeSingle();
  if (studentError) throw new Error(studentError.message);
  if (!student) throw new Error(`Student ${studentId} not found`);

  const { data: listed, error: listError } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw new Error(listError.message);
  const user = listed.users.find((u) => String(u.email ?? "").trim().toLowerCase() === email);
  if (!user) throw new Error(`Auth user not found for ${email}`);

  const { error: upsertError } = await sb.from("user_profiles").upsert(
    {
      user_id: user.id,
      role: "student",
      student_id: studentId,
      tutor_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertError) throw new Error(upsertError.message);

  console.log("Linked student portal:");
  console.log({
    email: user.email,
    userId: user.id,
    studentId,
    nameZh: student.name_zh,
    nameEn: student.name_en,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
