import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeStudentId } from "@/lib/studentId";

export const dynamic = "force-dynamic";

function looksLikeEmail(raw: string): boolean {
  return raw.includes("@");
}

function looksLikeStudentId(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (looksLikeEmail(t)) return false;
  const sid = normalizeStudentId(t);
  return /^\d{1,8}$/.test(sid) || /^BM\d+$/i.test(t);
}

/**
 * Public helper for login: map student id → portal auth email.
 * Email inputs are returned as-is (normalized).
 */
export async function POST(request: NextRequest) {
  let body: { loginId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const loginId = String(body.loginId ?? "").trim();
  if (!loginId) {
    return NextResponse.json({ ok: false, error: "請輸入 Email 或學生號碼" }, { status: 400 });
  }

  if (looksLikeEmail(loginId)) {
    return NextResponse.json({
      ok: true,
      email: loginId.toLowerCase(),
      via: "email" as const,
    });
  }

  if (!looksLikeStudentId(loginId)) {
    // Fall through as email attempt (staff usernames that aren't ids)
    return NextResponse.json({
      ok: true,
      email: loginId.toLowerCase(),
      via: "email" as const,
    });
  }

  const studentId = normalizeStudentId(loginId);
  try {
    const sb = getSupabaseAdmin();
    const [{ data: student, error: studentError }, { data: profile, error: profileError }] =
      await Promise.all([
        sb.from("students").select("id, email").eq("id", studentId).maybeSingle(),
        sb
          .from("user_profiles")
          .select("user_id, role, student_id")
          .eq("student_id", studentId)
          .maybeSingle(),
      ]);

    if (studentError) throw new Error(studentError.message);
    if (profileError) throw new Error(profileError.message);

    if (!student) {
      return NextResponse.json({ ok: false, error: "找不到此學生號碼" }, { status: 404 });
    }
    if (!profile || String(profile.role ?? "") !== "student" || !profile.user_id) {
      return NextResponse.json(
        { ok: false, error: "此學生尚未開通 Portal 帳號，請聯絡 Beyond Math。" },
        { status: 404 },
      );
    }

    const email = String((student as { email?: string | null }).email ?? "")
      .trim()
      .toLowerCase();
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "此學生未設定 Email，無法登入。請聯絡 Beyond Math。" },
        { status: 400 },
      );
    }

    // Prefer Auth user email if different from student record (until sync)
    const { data: authData, error: authError } = await sb.auth.admin.getUserById(
      String(profile.user_id),
    );
    if (authError) throw new Error(authError.message);
    const authEmail = String(authData.user?.email ?? "")
      .trim()
      .toLowerCase();

    return NextResponse.json({
      ok: true,
      email: authEmail || email,
      via: "studentId" as const,
      studentId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "無法解析登入帳號";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
