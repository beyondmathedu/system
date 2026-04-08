"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession();
      if (mounted) {
        setChecking(false);
        if (!session) {
          setError("重設連結可能已過期，請回登入頁重新發送。");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (password.length < 6) {
      setError("新密碼至少 6 個字元。");
      return;
    }
    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致。");
      return;
    }
    setLoading(true);
    const { error: updateErr } = await supabaseBrowser.auth.updateUser({ password });
    setLoading(false);
    if (updateErr) {
      setError(updateErr.message || "更新密碼失敗");
      return;
    }
    setNotice("密碼已更新，2 秒後返回登入頁。");
    window.setTimeout(() => {
      router.replace("/login");
      router.refresh();
    }, 2000);
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto mt-20 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-3 text-center text-2xl font-bold tracking-tight text-[#1d76c2]">
          重設密碼
        </p>
        <p className="mt-1 text-sm text-slate-600">請輸入新的密碼。</p>
        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">新密碼</label>
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
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">確認新密碼</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-12 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/20"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-600 hover:bg-slate-100"
                aria-label={showConfirmPassword ? "隱藏確認密碼" : "顯示確認密碼"}
              >
                {showConfirmPassword ? (
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
            disabled={loading || checking}
            className="w-full rounded-lg bg-[#1d76c2] px-4 py-2 font-semibold text-white hover:bg-[#165f9d] disabled:opacity-60"
          >
            {loading ? "更新中..." : "更新密碼"}
          </button>
        </form>
      </div>
    </div>
  );
}
