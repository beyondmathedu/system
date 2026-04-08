"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: signInError } = await supabaseBrowser.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message || "登入失敗");
      return;
    }
    let target = next && next.startsWith("/") ? next : "";
    if (target === "/") target = "";
    if (!target) {
      const {
        data: { user },
      } = await supabaseBrowser.auth.getUser();
      if (user) {
        const { data: profile } = await supabaseBrowser
          .from("user_profiles")
          .select("role, student_id")
          .eq("user_id", user.id)
          .maybeSingle();
        const role = String((profile as any)?.role ?? "").toLowerCase();
        if (role === "student") {
          const sid = String((profile as any)?.student_id ?? "").trim();
          target = sid ? `/students/${encodeURIComponent(sid)}/lessons/2026` : "/daily-time-table";
        } else if (role === "tutor") {
          target = "/daily-time-table";
        } else {
          target = "/daily-time-table";
        }
      } else {
        target = "/daily-time-table";
      }
    }
    router.replace(target);
    router.refresh();
  }

  async function onForgotPassword() {
    setError("");
    setNotice("");
    const mail = email.trim();
    if (!mail) {
      setError("請先輸入 Email，再按忘記密碼。");
      return;
    }
    setLoading(true);
    const { error: resetErr } = await supabaseBrowser.auth.resetPasswordForEmail(mail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetErr) {
      setError(resetErr.message || "無法發送重設密碼郵件");
      return;
    }
    setNotice("已發送重設密碼郵件，請到信箱按連結。");
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto mt-20 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-3 text-center text-2xl font-bold tracking-tight text-[#1d76c2]">
          Beyond Math 管理系統
        </p>
        <h1 className="text-xl font-bold text-slate-900">登入</h1>
        <p className="mt-1 text-sm text-slate-600">
          用於課堂排課、學生課堂記錄、房間使用與 Tutor Monthly Lesson Record 管理。
        </p>
        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/20"
              required
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
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#1d76c2] px-4 py-2 font-semibold text-white hover:bg-[#165f9d] disabled:opacity-60"
          >
            {loading ? "登入中..." : "登入"}
          </button>
          <button
            type="button"
            onClick={() => void onForgotPassword()}
            disabled={loading}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            忘記密碼
          </button>
        </form>
      </div>
    </div>
  );
}
