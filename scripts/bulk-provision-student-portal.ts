/**
 * Bulk-create Supabase Auth users + link user_profiles for student portal.
 *
 * Login email  = students.email (Student Info)
 * Password     = students.student_phone (Contact number), min 6 chars after trim
 *
 * Prerequisites:
 * - `.env.local` has NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * - Each student has email + contact number on the Students page
 *
 * Dry run (default — no writes):
 *   npx tsx scripts/bulk-provision-student-portal.ts
 *
 * Create accounts:
 *   npx tsx scripts/bulk-provision-student-portal.ts --apply
 *
 * Optional:
 *   --student=00145
 *   --limit=20
 *   --exclude=00041,00179,00253,00254
 *   --password='OverrideSamePassword'  (ignore contact number; testing only)
 *   --invite                             (send invite email instead of contact-number password)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const invite = process.argv.includes("--invite");
const studentFilter = (() => {
  const arg = process.argv.find((a) => a.startsWith("--student="));
  return arg ? normalizeStudentId(arg.split("=")[1] ?? "") : "";
})();
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1] ?? 0) || 0) : 0;
const excludeArg = process.argv.find((a) => a.startsWith("--exclude="));
const excludeIds = new Set(
  (excludeArg ? excludeArg.slice("--exclude=".length) : "")
    .split(",")
    .map((id) => normalizeStudentId(id.trim()))
    .filter(Boolean),
);
const passwordArg = process.argv.find((a) => a.startsWith("--password="));
const sharedPasswordOverride = passwordArg ? passwordArg.slice("--password=".length) : "";

type StudentRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  email: string | null;
  student_phone: string | null;
};

type ReportRow = {
  studentId: string;
  email: string;
  status: string;
  detail: string;
};

/** Contact number as login password (trimmed; fall back to digits-only if needed). */
function passwordFromContactNumber(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length >= 6) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 6) return digits;
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (apply && !invite && sharedPasswordOverride && sharedPasswordOverride.length < 6) {
    console.error("--password override must be at least 6 characters.");
    process.exit(1);
  }

  let studentsQuery = sb
    .from("students")
    .select("id, name_zh, name_en, email, student_phone")
    .order("id", { ascending: true });
  if (studentFilter) studentsQuery = studentsQuery.eq("id", studentFilter);

  const { data: studentsRaw, error: studentsError } = await studentsQuery;
  if (studentsError) throw new Error(studentsError.message);

  let students = (studentsRaw ?? []) as StudentRow[];
  if (limit > 0) students = students.slice(0, limit);

  const [{ data: profilesRaw, error: profilesError }, authUsers] = await Promise.all([
    sb.from("user_profiles").select("user_id, role, student_id"),
    listAllAuthUsers(),
  ]);
  if (profilesError) throw new Error(profilesError.message);

  const profileByStudentId = new Map<string, { user_id: string; role: string }>();
  for (const row of profilesRaw ?? []) {
    const sid = normalizeStudentId(String((row as { student_id?: string | null }).student_id ?? ""));
    if (!sid) continue;
    profileByStudentId.set(sid, {
      user_id: String((row as { user_id?: string }).user_id ?? ""),
      role: String((row as { role?: string }).role ?? ""),
    });
  }

  const authByEmail = new Map<string, User>();
  for (const user of authUsers) {
    const email = String(user.email ?? "").trim().toLowerCase();
    if (email) authByEmail.set(email, user);
  }

  const emailOwners = new Map<string, string>();
  for (const student of students) {
    const email = String(student.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const sid = normalizeStudentId(student.id);
    const prev = emailOwners.get(email);
    if (prev && prev !== sid) {
      console.warn(`Duplicate email ${email} on students ${prev} and ${sid}`);
    } else {
      emailOwners.set(email, sid);
    }
  }

  const report: ReportRow[] = [];
  let created = 0;
  let linked = 0;
  let skipped = 0;
  let failed = 0;

  console.log(
    apply
      ? invite
        ? "APPLY mode — create/link + send invite emails"
        : sharedPasswordOverride
          ? "APPLY mode — create/link with shared --password override"
          : "APPLY mode — create/link (email + contact number as password)"
      : "DRY RUN — pass --apply to write",
  );
  console.log(`Students in scope: ${students.length}`);
  if (excludeIds.size > 0) {
    console.log(`Excluded ids: ${[...excludeIds].join(", ")}`);
  }

  for (const student of students) {
    const studentId = normalizeStudentId(student.id);
    if (excludeIds.has(studentId)) {
      skipped += 1;
      report.push({
        studentId,
        email: String(student.email ?? "").trim().toLowerCase(),
        status: "skipped",
        detail: "excluded by --exclude",
      });
      continue;
    }
    const email = String(student.email ?? "").trim().toLowerCase();
    const label = `${studentId} ${student.name_zh ?? ""} ${student.name_en ?? ""}`.trim();
    const loginPassword =
      sharedPasswordOverride || (!invite ? passwordFromContactNumber(student.student_phone) : null);

    if (!email) {
      skipped += 1;
      report.push({
        studentId,
        email: "",
        status: "skipped",
        detail: "no email on student record",
      });
      continue;
    }

    if (!invite && !loginPassword) {
      skipped += 1;
      report.push({
        studentId,
        email,
        status: "skipped",
        detail: "no contact number or too short for password (min 6 chars)",
      });
      continue;
    }

    if (emailOwners.get(email) !== studentId) {
      failed += 1;
      report.push({
        studentId,
        email,
        status: "failed",
        detail: "duplicate email on another student",
      });
      continue;
    }

    const existingProfile = profileByStudentId.get(studentId);
    if (existingProfile?.role === "student") {
      skipped += 1;
      report.push({
        studentId,
        email,
        status: "skipped",
        detail: `already linked (user ${existingProfile.user_id})`,
      });
      continue;
    }

    let authUser = authByEmail.get(email);
    let justCreated = false;

    if (!authUser) {
      if (!apply) {
        report.push({
          studentId,
          email,
          status: "would_create",
          detail: invite
            ? "create auth user + invite email + link profile"
            : "create auth user (password = contact number) + link profile",
        });
        continue;
      }

      if (invite) {
        const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000"}/reset-password`,
        });
        if (error) {
          failed += 1;
          report.push({ studentId, email, status: "failed", detail: error.message });
          continue;
        }
        authUser = data.user;
      } else {
        const { data, error } = await sb.auth.admin.createUser({
          email,
          password: loginPassword!,
          email_confirm: true,
        });
        if (error) {
          failed += 1;
          report.push({ studentId, email, status: "failed", detail: error.message });
          continue;
        }
        authUser = data.user;
      }
      if (authUser) {
        authByEmail.set(email, authUser);
        justCreated = true;
        created += 1;
      }
      await sleep(120);
    }

    if (!authUser) {
      failed += 1;
      report.push({ studentId, email, status: "failed", detail: "auth user missing after create" });
      continue;
    }

    if (!apply) {
      report.push({
        studentId,
        email,
        status: "would_link",
        detail: `link profile to user ${authUser.id}`,
      });
      continue;
    }

    const { error: upsertError } = await sb.from("user_profiles").upsert(
      {
        user_id: authUser.id,
        role: "student",
        student_id: studentId,
        tutor_id: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (upsertError) {
      failed += 1;
      report.push({ studentId, email, status: "failed", detail: upsertError.message });
      continue;
    }

    linked += 1;
    report.push({
      studentId,
      email,
      status: justCreated ? "created_and_linked" : "linked",
      detail: `user ${authUser.id} — ${label}`,
    });
    profileByStudentId.set(studentId, { user_id: authUser.id, role: "student" });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync("scripts/output", { recursive: true });
  const outPath = `scripts/output/student-portal-provision-${stamp}.csv`;
  const csv = [
    "student_id,email,status,detail",
    ...report.map((r) =>
      [r.studentId, r.email, r.status, `"${r.detail.replace(/"/g, '""')}"`].join(","),
    ),
  ].join("\n");
  writeFileSync(outPath, csv, "utf8");

  console.log("\nSummary:");
  console.log({ created, linked, skipped, failed, reportRows: report.length });
  console.log(`Report: ${outPath}`);

  if (!apply) {
    console.log("\nNext: review the report, then run with --apply.");
  } else if (!invite && !sharedPasswordOverride) {
    console.log("\nStudents log in with Student Info email + Contact number as password.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
