import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SheetStudentRow = {
  id?: unknown;
  name_zh?: unknown;
  name_en?: unknown;
  nickname_en?: unknown;
  birth_date?: unknown;
  student_phone?: unknown;
  email?: unknown;
  school?: unknown;
  grade?: unknown;
  math_language?: unknown;
};

const NA = /^#N\/A$/i;

function str(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (NA.test(s)) return "";
  return s;
}

function normalizeBirthDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = str(v);
  if (!s) return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  return s;
}

function normalizeRow(raw: SheetStudentRow) {
  return {
    id: str(raw.id).toUpperCase(),
    name_zh: str(raw.name_zh),
    name_en: str(raw.name_en),
    nickname_en: str(raw.nickname_en),
    birth_date: normalizeBirthDate(raw.birth_date),
    student_phone: str(raw.student_phone),
    email: str(raw.email),
    school: str(raw.school),
    grade: str(raw.grade),
    math_language: str(raw.math_language) || "英文",
  };
}

function isUsableRow(r: ReturnType<typeof normalizeRow>): boolean {
  if (!r.id) return false;
  if (!r.name_zh && !r.name_en) return false;
  return true;
}

/**
 * POST /api/sync/students-from-sheet
 *
 * Header: Authorization: Bearer <STUDENT_SYNC_SECRET>
 * 或 body: { "secret": "<STUDENT_SYNC_SECRET>", "students": [...] }
 *
 * 每筆 students 物件欄位須對應 Supabase students 表（snake_case）。
 * 試算表 A–J 若依你截圖：F 實際為電郵、G 實際為電話，請在 Apps Script 組 JSON 時
 * 把 F → email、G → student_phone（見 scripts/google-apps-script-student-sync.gs）。
 */
export async function POST(request: Request) {
  const expected = process.env.STUDENT_SYNC_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "STUDENT_SYNC_SECRET 未設定，無法同步。" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  let body: { secret?: string; students?: SheetStudentRow[] } | null = null;
  try {
    body = (await request.json()) as { secret?: string; students?: SheetStudentRow[] };
  } catch {
    return NextResponse.json({ ok: false, error: "無效的 JSON body。" }, { status: 400 });
  }

  if (bearer !== expected && body.secret !== expected) {
    return NextResponse.json({ ok: false, error: "未授權。" }, { status: 401 });
  }

  if (!Array.isArray(body.students)) {
    return NextResponse.json({ ok: false, error: "請提供 students 陣列。" }, { status: 400 });
  }

  const normalized = body.students.map(normalizeRow);
  const skipped = normalized.filter((r) => !isUsableRow(r)).length;
  const rows = normalized.filter(isUsableRow);

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      skipped,
      message: "沒有可寫入的列（需有 id 且至少 name_zh 或 name_en）。",
    });
  }

  const CHUNK = 80;
  let upserted = 0;
  const errors: string[] = [];

  try {
    const admin = getSupabaseAdmin();
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await admin.from("students").upsert(chunk, { onConflict: "id" });
      if (error) {
        errors.push(`第 ${i + 1}–${i + chunk.length} 筆：${error.message}`);
      } else {
        upserted += chunk.length;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({
    ok: errors.length === 0,
    upserted,
    skipped,
    errors: errors.length ? errors : undefined,
  });
}
