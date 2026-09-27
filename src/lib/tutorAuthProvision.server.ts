import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  TUTOR_SHARED_IPAD_EMAIL,
  TUTOR_SHARED_IPAD_ID,
} from "@/lib/tutorConstants";

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

/** Shared classroom login used by all tutors (iPad account). */
export async function getSharedTutorLoginStatus(): Promise<TutorAuthStatusRow> {
  const sb = getSupabaseAdmin();
  const tid = TUTOR_SHARED_IPAD_ID;

  try {
    const userId = await resolveTutorAuthUserId(sb, tid);
    const { data, error } = await sb.auth.admin.getUserById(userId);
    if (!error && data.user) {
      return {
        tutorId: tid,
        hasAccount: true,
        authEmail: data.user.email ? normalizeEmail(data.user.email) : TUTOR_SHARED_IPAD_EMAIL,
      };
    }
  } catch {
    /* fall through to email lookup */
  }

  const byEmail = await findAuthUserByEmail(TUTOR_SHARED_IPAD_EMAIL);
  if (byEmail) {
    return {
      tutorId: tid,
      hasAccount: true,
      authEmail: normalizeEmail(byEmail.email) || TUTOR_SHARED_IPAD_EMAIL,
    };
  }

  return { tutorId: tid, hasAccount: false, authEmail: TUTOR_SHARED_IPAD_EMAIL };
}

export async function resetSharedTutorLoginPassword(password: string): Promise<TutorAuthActionResult> {
  const trimmedPassword = String(password ?? "").trim();
  if (trimmedPassword.length < 6) {
    throw new Error("新密碼至少 6 個字元。");
  }

  const sb = getSupabaseAdmin();
  const tid = TUTOR_SHARED_IPAD_ID;
  let userId: string | null = null;

  try {
    userId = await resolveTutorAuthUserId(sb, tid);
  } catch {
    const byEmail = await findAuthUserByEmail(TUTOR_SHARED_IPAD_EMAIL);
    userId = byEmail?.id ?? null;
    if (userId) {
      // Keep profile linked so future resets / role checks stay consistent.
      const { error: upsertError } = await sb.from("user_profiles").upsert(
        {
          user_id: userId,
          role: "tutor",
          tutor_id: tid,
          student_id: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (upsertError) throw new Error(upsertError.message);
    }
  }

  if (!userId) {
    throw new Error(
      `尚未找到共用登入帳（${TUTOR_SHARED_IPAD_EMAIL}）。請先在 Supabase Auth 建立此電郵用戶。`,
    );
  }

  const { error } = await sb.auth.admin.updateUserById(userId, { password: trimmedPassword });
  if (error) throw new Error(error.message);

  return {
    ok: true,
    action: "reset-password",
    message: "共用 Tutor 登入密碼已更新。所有老師用同一組電郵／密碼登入。",
    userId,
  };
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
    if (tid === TUTOR_SHARED_IPAD_ID) {
      out[tid] = await getSharedTutorLoginStatus();
      continue;
    }
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

  if (tid === TUTOR_SHARED_IPAD_ID || tid.toLowerCase() === "shared") {
    return resetSharedTutorLoginPassword(password);
  }

  const trimmedPassword = String(password ?? "").trim();
  if (trimmedPassword.length < 6) {
    throw new Error("新密碼至少 6 個字元。");
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
    message: "Tutor 登入密碼已更新。",
    userId,
  };
}
