import { NextResponse } from "next/server";
import { runStudentGradePromotion } from "@/lib/runStudentGradePromotion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron: annual student grade promotion (Sept 1–7 HK, 08:00 daily).
 * Requires CRON_SECRET; Vercel sends Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET 未設定，無法執行定時升級。" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer !== cronSecret) {
    return NextResponse.json({ ok: false, error: "未授權。" }, { status: 401 });
  }

  try {
    const result = await runStudentGradePromotion();
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
