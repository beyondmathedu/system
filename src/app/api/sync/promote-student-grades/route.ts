import { NextResponse } from "next/server";
import { runStudentGradePromotion } from "@/lib/runStudentGradePromotion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PromoteBody = {
  secret?: string;
  year?: number;
  force?: boolean;
};

/**
 * POST /api/sync/promote-student-grades
 *
 * Header: Authorization: Bearer <STUDENT_GRADE_PROMOTION_SECRET>
 * or body: { "secret": "<STUDENT_GRADE_PROMOTION_SECRET>", "year"?: 2026, "force"?: false }
 */
export async function POST(request: Request) {
  const expected = process.env.STUDENT_GRADE_PROMOTION_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "STUDENT_GRADE_PROMOTION_SECRET 未設定，無法執行升級。" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  let body: PromoteBody = {};
  try {
    body = (await request.json()) as PromoteBody;
  } catch {
    body = {};
  }

  if (bearer !== expected && body.secret?.trim() !== expected) {
    return NextResponse.json({ ok: false, error: "未授權。" }, { status: 401 });
  }

  const year =
    typeof body.year === "number" && Number.isFinite(body.year)
      ? Math.trunc(body.year)
      : null;
  const force = body.force === true;

  try {
    const result = await runStudentGradePromotion({ year, force });
    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
