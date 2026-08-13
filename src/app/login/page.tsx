"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import ClientOnlyAfterMount from "@/components/ClientOnlyAfterMount";
import { defaultDailyTimetablePath } from "@/lib/tutorRoomAccess";
import { studentPostLoginPath } from "@/lib/studentPortalAccess";
import { normalizeStudentId } from "@/lib/studentId";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

function LoginFormFieldsFallback() {
  return (
    <div className="mt-5 space-y-4" aria-hidden>
      <div>
        <div className="mb-1 h-4 w-12 rounded bg-slate-200" />
        <div className="h-10 w-full rounded-lg bg-slate-100" />
      </div>
      <div>
        <div className="mb-1 h-4 w-16 rounded bg-slate-200" />
        <div className="h-10 w-full rounded-lg bg-slate-100" />
      </div>
      <div className="h-10 w-full rounded-lg bg-slate-200" />
    </div>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const linkError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const linkErrorMessage = linkError ? "登入連結無效，請再試一次。" : "";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: signInError } = await supabaseBrowser.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setLoading(false);
      const msg = signInError.message || "登入失敗";
      if (/invalid login credentials/i.test(msg)) {
        setError(
          "Email 或密碼不正確。若剛重設密碼，請用郵件裡設定的新密碼；或到 Supabase → Authentication → Users 確認此 Email 已建立並已 Auto Confirm。",
        );
      } else {
        setError(msg);
      }
      return;
    }
    const { data: sessionData, error: sessionError } = await supabaseBrowser.auth.getSession();
    if (sessionError || !sessionData.session) {
      setLoading(false);
      setError(sessionError?.message || "登入成功但未能建立工作階段，請再試一次");
      return;
    }
    let target = "";
    try {
      const meRes = await fetch("/api/me", { credentials: "same-origin" });
      if (meRes.ok) {
        const me = (await meRes.json()) as {
          role?: string;
          studentId?: string | null;
          allowedRoomSlugs?: string[];
          isSharedIpadTutor?: boolean;
        };
        const role = String(me.role ?? "").toLowerCase();
        if (role === "student") {
          const sid = normalizeStudentId(String(me.studentId ?? ""));
          if (sid) target = studentPostLoginPath(sid);
        } else if (role === "tutor") {
          target = defaultDailyTimetablePath();
        }
      }
    } catch {
      /* use next / default below */
    }
    if (!target) {
      const next = searchParams.get("next");
      target = next && next.startsWith("/") ? next : "";
      if (target === "/") target = "";
    }
    if (!target) target = "/home";
    window.location.assign(target);
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto mt-20 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-3 text-center text-2xl font-bold tracking-tight text-[#1d76c2]">
          Beyond Math 管理系統
        </p>
        <h1 className="text-xl font-bold text-slate-900">登入</h1>
        <p className="mt-1 text-sm text-slate-600">
          用於課堂排課、學生課堂記錄、房間使用與 Tutor Monthly Record 管理。
        </p>
        <ClientOnlyAfterMount fallback={<LoginFormFieldsFallback />}>
          <form className="mt-5 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/20"
                required
                autoComplete="email"
              />
            </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-12 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/20"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-600 hover:bg-slate-100"
                aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.6a2 2 0 102.8 2.8" />
                    <path d="M9.9 5.2A10.7 10.7 0 0112 5c5.2 0 9.3 3.4 10 7-0.3 1.6-1.3 3-2.8 4.2" />
                    <path d="M6.2 6.2C4.3 7.6 3.2 9.3 3 12c0.7 3.6 4.8 7 10 7 1.7 0 3.2-.3 4.5-.9" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
                </button>
              </div>
            </div>
            {linkErrorMessage && !error ? (
              <p className="text-sm text-rose-600">{linkErrorMessage}</p>
            ) : null}
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#1d76c2] px-4 py-2 font-semibold text-white hover:bg-[#165f9d] disabled:opacity-60"
            >
              {loading ? "登入中..." : "登入"}
            </button>
          </form>
        </ClientOnlyAfterMount>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 p-6">
          <div className="mx-auto mt-20 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
            載入中…
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
