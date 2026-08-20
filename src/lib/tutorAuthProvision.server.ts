import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type TutorAuthStatusRow = {
  tutorId: string;
  hasAccount: boolean;
  authEmail: string | null;
};

export type TutorAuthActionResult = {
  ok: boolean;
  action: "reset-password";
  message: string;
  userId?: string;
};

function normalizeTutorId(raw: string): string {
  return String(raw ?? "").trim();
}

function normalizeEmail(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase();
}

async function getAuthUsersByIds(
  sb: SupabaseClient,
  userIds: string[],
): Promise<Map<string, User>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, User>();
  if (!unique.length) return out;

  const concurrency = 8;
  let idx = 0;
  async function worker() {
    while (idx < unique.length) {
      const i = idx;
      idx += 1;
      const id = unique[i]!;
      const { data, error } = await sb.auth.admin.getUserById(id);
      if (error || !data.user) continue;
      out.set(id, data.user);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()));
  return out;
}

async function resolveTutorAuthUserId(sb: SupabaseClient, tutorId: string): Promise<string> {
  const { data, error } = await sb
    .from("user_profiles")
    .select("user_id, role")
    .eq("tutor_id", tutorId)
    .eq("role", "tutor");
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((row) => String((row as { user_id?: string }).user_id ?? "").trim());
  if (!rows.length) {
    throw new Error("No login account linked to this tutor. Link user_profiles first.");
  }
  if (rows.length > 1) {
    throw new Error("Multiple login accounts linked to this tutor. Fix user_profiles first.");
  }
  return String((rows[0] as { user_id: string }).user_id);
}

export async function getTutorAuthStatusBatch(
  tutorIds: string[],
): Promise<Record<string, TutorAuthStatusRow>> {
  const ids = [...new Set(tutorIds.map(normalizeTutorId).filter(Boolean))];
  const out: Record<string, TutorAuthStatusRow> = {};
  if (!ids.length) return out;

  const sb = getSupabaseAdmin();
  const { data: profilesRaw, error: profilesError } = await sb
    .from("user_profiles")
    .select("user_id, role, tutor_id")
    .in("tutor_id", ids)
    .eq("role", "tutor");
  if (profilesError) throw new Error(profilesError.message);

  const profileByTutorId = new Map<string, { user_id: string }>();
  for (const row of profilesRaw ?? []) {
    const tid = normalizeTutorId(String((row as { tutor_id?: string | null }).tutor_id ?? ""));
    const userId = String((row as { user_id?: string }).user_id ?? "").trim();
    if (!tid || !userId) continue;
    if (profileByTutorId.has(tid)) continue;
    profileByTutorId.set(tid, { user_id: userId });
  }

  const linkedUserIds = [...profileByTutorId.values()].map((p) => p.user_id);
  const authById = await getAuthUsersByIds(sb, linkedUserIds);

  for (const tid of ids) {
    const profile = profileByTutorId.get(tid);
    const hasAccount = Boolean(profile?.user_id);
    const authUser = hasAccount ? authById.get(profile!.user_id) : undefined;
    out[tid] = {
      tutorId: tid,
      hasAccount,
      authEmail: authUser?.email ? normalizeEmail(authUser.email) : null,
    };
  }

  return out;
}

export async function resetTutorPassword(
  tutorId: string,
  password: string,
): Promise<TutorAuthActionResult> {
  const tid = normalizeTutorId(tutorId);
  if (!tid) throw new Error("Invalid tutor id");

  const trimmedPassword = String(password ?? "").trim();
  if (trimmedPassword.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const sb = getSupabaseAdmin();
  const { data: tutorRow, error: tutorError } = await sb.from("tutors").select("id").eq("id", tid).maybeSingle();
  if (tutorError) throw new Error(tutorError.message);
  if (!tutorRow) throw new Error(`Tutor ${tid} not found`);

  const userId = await resolveTutorAuthUserId(sb, tid);
  const { error } = await sb.auth.admin.updateUserById(userId, { password: trimmedPassword });
  if (error) throw new Error(error.message);

  return {
    ok: true,
    action: "reset-password",
    message: "Tutor login password updated.",
    userId,
  };
}
