/**
 * Provision portal accounts for students who share a parent email
 * (cannot use email login; login via student id only).
 *
 * Auth email = {studentId}@id.beyondmath.student  (synthetic, unique)
 * Password   = students.student_phone
 *
 * Dry run:
 *   npx tsx scripts/provision-student-id-login-accounts.ts
 *
 * Apply:
 *   npx tsx scripts/provision-student-id-login-accounts.ts --apply
 *
 * Optional:
 *   --student=00041,00179
 */
import { readFileSync } from "node:fs";
import { createClient, type User } from "@supabase/supabase-js";
import { normalizeStudentId } from "../src/lib/studentId";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceKey);
const apply = process.argv.includes("--apply");

const DEFAULT_IDS = ["00041", "00179", "00253", "00254"];
const studentArg = process.argv.find((a) => a.startsWith("--student="));
const targetIds = (studentArg ? studentArg.slice("--student=".length).split(",") : DEFAULT_IDS)
  .map((id) => normalizeStudentId(id.trim()))
  .filter(Boolean);

function syntheticAuthEmail(studentId: string): string {
  return `${studentId}@id.beyondmath.student`;
}

function passwordFromContactNumber(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length >= 6) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 6) return digits;
  return null;
}

async function listAllAuthUsers(): Promise<User[]> {
  const users: User[] = [];
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    users.push(...(data.users ?? []));
    if ((data.users ?? []).length < perPage) break;
    page += 1;
  }
  return users;
}

async function main() {
  console.log(apply ? "APPLY mode" : "DRY RUN (pass --apply to write)");
  console.log(`Targets: ${targetIds.join(", ")}`);

  const { data: studentsRaw, error: studentsError } = await sb
    .from("students")
    .select("id, name_zh, name_en, email, student_phone")
    .in("id", targetIds);
  if (studentsError) throw new Error(studentsError.message);

  const students = new Map(
    (studentsRaw ?? []).map((row) => [normalizeStudentId(String(row.id)), row]),
  );

  const { data: profilesRaw, error: profilesError } = await sb
    .from("user_profiles")
    .select("user_id, role, student_id")
    .in("student_id", targetIds);
  if (profilesError) throw new Error(profilesError.message);

  const profileByStudent = new Map(
    (profilesRaw ?? []).map((row) => [normalizeStudentId(String(row.student_id ?? "")), row]),
  );

  const authUsers = await listAllAuthUsers();
  const authByEmail = new Map(
    authUsers
      .filter((u) => u.email)
      .map((u) => [String(u.email).trim().toLowerCase(), u] as const),
  );

  for (const sid of targetIds) {
    const student = students.get(sid);
    if (!student) {
      console.log(`[${sid}] SKIP — student not found`);
      continue;
    }

    const contactEmail = String(student.email ?? "").trim().toLowerCase();
    const authEmail = syntheticAuthEmail(sid);
    const password = passwordFromContactNumber(student.student_phone);
    const existingProfile = profileByStudent.get(sid);

    console.log(
      `\n[${sid}] ${student.name_zh ?? ""} / ${student.name_en ?? ""}` +
        `\n  contact email (kept on student record): ${contactEmail || "(none)"}` +
        `\n  auth login email (student-id only): ${authEmail}` +
        `\n  password from phone: ${password ? "ok" : "MISSING/TOO SHORT"}` +
        `\n  existing profile: ${
          existingProfile?.role === "student" ? `yes (${existingProfile.user_id})` : "no"
        }`,
    );

    if (!password) {
      console.log(`  → SKIP — contact number too short`);
      continue;
    }

    if (existingProfile?.role === "student" && existingProfile.user_id) {
      console.log(`  → SKIP — portal already linked; use reset-password if needed`);
      continue;
    }

    let authUser = authByEmail.get(authEmail);
    if (!authUser && apply) {
      const { data, error } = await sb.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {
          student_id: sid,
          login_via: "student_id_only",
          contact_email: contactEmail || null,
        },
      });
      if (error) {
        console.log(`  → FAIL createUser: ${error.message}`);
        continue;
      }
      authUser = data.user ?? undefined;
      console.log(`  → created auth user ${authUser?.id}`);
    } else if (!authUser) {
      console.log(`  → would create auth user`);
    } else {
      console.log(`  → reuse existing auth user ${authUser.id}`);
      if (apply) {
        const { error } = await sb.auth.admin.updateUserById(authUser.id, { password });
        if (error) console.log(`  → WARN password update: ${error.message}`);
        else console.log(`  → password set to contact number`);
      } else {
        console.log(`  → would set password to contact number`);
      }
    }

    if (!apply) {
      console.log(`  → would link user_profiles role=student student_id=${sid}`);
      continue;
    }

    if (!authUser?.id) {
      console.log(`  → FAIL — no auth user id`);
      continue;
    }

    const { error: upsertError } = await sb.from("user_profiles").upsert(
      {
        user_id: authUser.id,
        role: "student",
        student_id: sid,
        tutor_id: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (upsertError) {
      console.log(`  → FAIL profile upsert: ${upsertError.message}`);
      continue;
    }
    console.log(`  → linked portal account (login with student id + contact phone)`);
  }

  console.log("\nDone.");
  if (!apply) console.log("Re-run with --apply to write changes.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
