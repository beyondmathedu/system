import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { computeStudentPortalAccessState } from "@/lib/studentPortalAccess.server";
import {
  passwordFromContactNumber,
  validateStudentContactPhone,
  validateStudentEmailFormat,
} from "@/lib/studentPortalCredentials";
import { defaultLessonYear } from "@/lib/lessonCalendar";
import { hkTodayIso } from "@/lib/examDateVisibility";
import { loadStudentInactivePeriodsBatchServer } from "@/lib/lessonDataServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeStudentId } from "@/lib/studentId";
import { buildStudentInactivePeriodsById } from "@/lib/studentVisibility";

export type StudentPortalStatusRow = {
  studentId: string;
  hasAccount: boolean;
  authEmail: string | null;
  loginAllowed: boolean;
  reactivateDate: string | null;
  ready: boolean;
  readyReason: string | null;
  /** Auth uses synthetic email; student must log in with student id, not contact email. */
  studentIdLoginOnly: boolean;
};

/** Synthetic Auth email for siblings sharing one contact email. */
export function studentIdOnlyAuthEmail(studentId: string): string {
  const sid = normalizeStudentId(studentId);
  return `${sid}@id.beyondmath.student`;
}

export function isStudentIdOnlyAuthEmail(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  return /^[0-9]+@id\.beyondmath\.student$/.test(e);
}

export type StudentPortalProvisionResult = {
  ok: boolean;
  action: "created" | "linked" | "reset-password" | "sync-email";
  message: string;
  userId?: string;
};

type StudentRecord = {
  id: string;
  email: string | null;
  student_phone: string | null;
  grade?: string | null;
};

/** Contact number as login password — exactly 8 digits, no spaces. */
export { passwordFromContactNumber } from "@/lib/studentPortalCredentials";

function normalizeEmail(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Look up one Auth user by email without listing the whole user directory. */
async function findAuthUserByEmail(email: string): Promise<User | undefined> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  const target = normalizeEmail(email);
  if (!target) return undefined;

  const res = await fetch(
    `${url}/auth/v1/admin/users?page=1&per_page=50&filter=${encodeURIComponent(target)}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Auth email lookup failed (${res.status})`);
  }
  const body = (await res.json()) as { users?: User[] };
  return (body.users ?? []).find((u) => normalizeEmail(u.email) === target);
}

async function loadStudentRecord(sb: SupabaseClient, studentId: string): Promise<StudentRecord | null> {
  const { data, error } = await sb
    .from("students")
    .select("id, email, student_phone")
    .eq("id", studentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as StudentRecord;
}

async function assertStudentEmailUnique(
  sb: SupabaseClient,
  studentId: string,
  email: string,
): Promise<void> {
  const { data, error } = await sb
    .from("students")
    .select("id")
    .ilike("email", email)
    .neq("id", studentId)
    .limit(1);
  if (error) throw new Error(error.message);
  if (data?.length) {
    const otherId = normalizeStudentId(String(data[0]?.id ?? ""));
    throw new Error(
      `Email ${email} is already used by another student${otherId ? ` ${otherId}` : ""}.`,
    );
  }
}

function readiness(student: StudentRecord): { ready: boolean; readyReason: string | null } {
  const emailCheck = validateStudentEmailFormat(student.email);
  if (!emailCheck.ok) return { ready: false, readyReason: emailCheck.error };
  const phoneCheck = validateStudentContactPhone(student.student_phone);
  if (!phoneCheck.ok) return { ready: false, readyReason: phoneCheck.error };
  return { ready: true, readyReason: null };
}

export async function getStudentPortalStatusBatch(
  studentIds: string[],
): Promise<Record<string, StudentPortalStatusRow>> {
  const ids = [...new Set(studentIds.map((id) => normalizeStudentId(id)).filter(Boolean))];
  const out: Record<string, StudentPortalStatusRow> = {};
  if (!ids.length) return out;

  const sb = getSupabaseAdmin();
  const [{ data: studentsRaw, error: studentsError }, { data: profilesRaw, error: profilesError }, periodRows] =
    await Promise.all([
      sb.from("students").select("id, email, student_phone, grade").in("id", ids),
      sb
        .from("user_profiles")
        .select("user_id, role, student_id, portal_auth_email, portal_student_id_login_only")
        .in("student_id", ids),
      loadStudentInactivePeriodsBatchServer(sb, ids),
    ]);
  if (studentsError) throw new Error(studentsError.message);
  if (profilesError) throw new Error(profilesError.message);

  const studentsById = new Map<string, StudentRecord>();
  for (const row of studentsRaw ?? []) {
    const sid = normalizeStudentId(String((row as StudentRecord).id ?? ""));
    if (sid) studentsById.set(sid, row as StudentRecord);
  }

  const profileByStudentId = new Map<
    string,
    {
      user_id: string;
      role: string;
      portal_auth_email: string | null;
      portal_student_id_login_only: boolean;
    }
  >();
  for (const row of profilesRaw ?? []) {
    const typed = row as {
      student_id?: string | null;
      user_id?: string;
      role?: string;
      portal_auth_email?: string | null;
      portal_student_id_login_only?: boolean | null;
    };
    const sid = normalizeStudentId(String(typed.student_id ?? ""));
    if (!sid) continue;
    profileByStudentId.set(sid, {
      user_id: String(typed.user_id ?? ""),
      role: String(typed.role ?? ""),
      portal_auth_email: typed.portal_auth_email ? normalizeEmail(typed.portal_auth_email) : null,
      portal_student_id_login_only: Boolean(typed.portal_student_id_login_only),
    });
  }

  const periodsById = buildStudentInactivePeriodsById(periodRows);
  const todayIso = hkTodayIso();
  const year = defaultLessonYear();

  for (const sid of ids) {
    const student = studentsById.get(sid);
    if (!student) {
      out[sid] = {
        studentId: sid,
        hasAccount: false,
        authEmail: null,
        loginAllowed: false,
        reactivateDate: null,
        ready: false,
        readyReason: "Student not found",
        studentIdLoginOnly: false,
      };
      continue;
    }

    const { ready, readyReason } = readiness(student);
    const profile = profileByStudentId.get(sid);
    const hasAccount = profile?.role === "student" && Boolean(profile.user_id);
    const authEmail = hasAccount ? profile!.portal_auth_email : null;
    const access = computeStudentPortalAccessState({
      studentId: sid,
      grade: student.grade,
      periods: periodsById[sid] ?? [],
      todayIso,
      year,
    });

    out[sid] = {
      studentId: sid,
      hasAccount,
      authEmail,
      loginAllowed: access.allowed,
      reactivateDate: access.reactivateDate,
      ready,
      readyReason,
      studentIdLoginOnly:
        profile?.portal_student_id_login_only ?? isStudentIdOnlyAuthEmail(authEmail),
    };
  }

  return out;
}

export async function provisionStudentPortalAccount(
  studentId: string,
  options?: { passwordOverride?: string; studentIdLoginOnly?: boolean },
): Promise<StudentPortalProvisionResult> {
  const sid = normalizeStudentId(studentId);
  if (!sid) throw new Error("Invalid student id");

  const sb = getSupabaseAdmin();
  const student = await loadStudentRecord(sb, sid);
  if (!student) throw new Error(`Student ${sid} not found`);

  const emailCheck = validateStudentEmailFormat(student.email);
  const phoneCheck = validateStudentContactPhone(student.student_phone);
  if (!emailCheck.ok) throw new Error(emailCheck.error);
  if (!options?.passwordOverride && !phoneCheck.ok) throw new Error(phoneCheck.error);

  const studentIdLoginOnly = Boolean(options?.studentIdLoginOnly);
  const contactEmail = emailCheck.value;
  const authEmail = studentIdLoginOnly ? studentIdOnlyAuthEmail(sid) : contactEmail;

  if (!studentIdLoginOnly) {
    await assertStudentEmailUnique(sb, sid, contactEmail);
  }

  const password = options?.passwordOverride?.trim() || (phoneCheck.ok ? phoneCheck.value : null);
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }

  let authUser = await findAuthUserByEmail(authEmail);

  const existingProfile = await sb
    .from("user_profiles")
    .select("user_id, role, student_id")
    .eq("student_id", sid)
    .maybeSingle();

  if (existingProfile.data?.role === "student" && existingProfile.data.user_id) {
    throw new Error("Portal account already exists for this student. Use Reset password instead.");
  }

  let action: StudentPortalProvisionResult["action"] = "linked";
  if (!authUser) {
    const { data, error } = await sb.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: studentIdLoginOnly
        ? {
            student_id: sid,
            login_via: "student_id_only",
            contact_email: contactEmail,
          }
        : undefined,
    });
    if (error) throw new Error(error.message);
    authUser = data.user;
    action = "created";
  }

  if (!authUser) throw new Error("Failed to create or find auth user");

  const { error: upsertError } = await sb.from("user_profiles").upsert(
    {
      user_id: authUser.id,
      role: "student",
      student_id: sid,
      tutor_id: null,
      portal_auth_email: authEmail,
      portal_student_id_login_only: studentIdLoginOnly,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertError) throw new Error(upsertError.message);

  return {
    ok: true,
    action,
    message: studentIdLoginOnly
      ? "Portal account created — login with student ID + contact number (email is shared)."
      : action === "created"
        ? "Portal account created (email + contact number password)."
        : "Linked existing auth user to this student.",
    userId: authUser.id,
  };
}

async function resolvePortalUserId(sb: SupabaseClient, studentId: string): Promise<string> {
  const { data, error } = await sb
    .from("user_profiles")
    .select("user_id, role")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || String(data.role ?? "") !== "student" || !data.user_id) {
    throw new Error("No portal account for this student. Create one first.");
  }
  return String(data.user_id);
}

export async function resetStudentPortalPassword(
  studentId: string,
  options?: { passwordOverride?: string },
): Promise<StudentPortalProvisionResult> {
  const sid = normalizeStudentId(studentId);
  if (!sid) throw new Error("Invalid student id");

  const sb = getSupabaseAdmin();
  const student = await loadStudentRecord(sb, sid);
  if (!student) throw new Error(`Student ${sid} not found`);

  const password = options?.passwordOverride?.trim() || passwordFromContactNumber(student.student_phone);
  if (!password || password.length < 6) {
    throw new Error("Contact number must be exactly 8 digits (no spaces) to reset password.");
  }

  const userId = await resolvePortalUserId(sb, sid);
  const { error } = await sb.auth.admin.updateUserById(userId, { password });
  if (error) throw new Error(error.message);

  return {
    ok: true,
    action: "reset-password",
    message: "Password reset to contact number.",
    userId,
  };
}

export async function syncStudentPortalEmail(studentId: string): Promise<StudentPortalProvisionResult> {
  const sid = normalizeStudentId(studentId);
  if (!sid) throw new Error("Invalid student id");

  const sb = getSupabaseAdmin();
  const userId = await resolvePortalUserId(sb, sid);
  const { data: authData, error: authLookupError } = await sb.auth.admin.getUserById(userId);
  if (authLookupError) throw new Error(authLookupError.message);
  if (isStudentIdOnlyAuthEmail(authData.user?.email)) {
    throw new Error(
      "This student logs in with student ID only (shared contact email). Do not sync Auth email.",
    );
  }

  const student = await loadStudentRecord(sb, sid);
  if (!student) throw new Error(`Student ${sid} not found`);

  const emailCheck = validateStudentEmailFormat(student.email);
  if (!emailCheck.ok) throw new Error(emailCheck.error);
  const email = emailCheck.value;
  await assertStudentEmailUnique(sb, sid, email);

  const { error } = await sb.auth.admin.updateUserById(userId, { email });
  if (error) throw new Error(error.message);

  const { error: profileError } = await sb
    .from("user_profiles")
    .update({
      portal_auth_email: email,
      portal_student_id_login_only: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (profileError) throw new Error(profileError.message);

  return {
    ok: true,
    action: "sync-email",
    message: "Login email updated to match student record.",
    userId,
  };
}
