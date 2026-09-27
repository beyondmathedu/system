import { NextResponse } from "next/server";
import path from "node:path";
import { revalidateTag } from "next/cache";
import { getViewerContext } from "@/lib/authz";
import { SCHEDULE_CACHE_TAG_FEE_RECORD } from "@/lib/scheduleCacheTags";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  matchExcelNameToStudentId,
  parseTuitionFeeRecordExcel,
  TUITION_FEE_RECORD_EXCEL_RELATIVE,
} from "@/lib/tuitionFeeRecordExcel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type StudentRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  nickname_en: string | null;
};

/**
 * Import staff ground-truth tuition paid (May–Dec) from data/tuition-fee-record-2026.xlsx.
 * Zoho Sync should converge to the same numbers via Item & Description month + Amount.
 */
export async function POST() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const absolutePath = path.join(process.cwd(), TUITION_FEE_RECORD_EXCEL_RELATIVE);
    const parsed = await parseTuitionFeeRecordExcel(absolutePath, 2026);
    const admin = getSupabaseAdmin();
    const { data: students, error: stErr } = await admin
      .from("students")
      .select("id, name_zh, name_en, nickname_en")
      .returns<StudentRow[]>();
    if (stErr) {
      return NextResponse.json({ ok: false, error: stErr.message }, { status: 500 });
    }

    const unmatchedNames = new Set<string>();
    const byStudentMonth = new Map<string, number>();
    for (const cell of parsed.cells) {
      const sid = matchExcelNameToStudentId(cell.name, students ?? []);
      if (!sid) {
        unmatchedNames.add(cell.name);
        continue;
      }
      const key = `${sid}:${cell.month}`;
      byStudentMonth.set(key, (byStudentMonth.get(key) ?? 0) + cell.amount);
    }

    const nowIso = new Date().toISOString();
    const upserts = Array.from(byStudentMonth.entries()).map(([key, amount]) => {
      const [student_id, monthStr] = key.split(":");
      return {
        student_id,
        year: parsed.year,
        month: Number(monthStr),
        submitted_amount: Math.round(amount * 100) / 100,
        updated_at: nowIso,
      };
    });

    for (let i = 0; i < upserts.length; i += 400) {
      const chunk = upserts.slice(i, i + 400);
      const { error } = await admin
        .from("student_monthly_fee_records")
        .upsert(chunk, { onConflict: "student_id,year,month" });
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    revalidateTag(SCHEDULE_CACHE_TAG_FEE_RECORD, "max");

    return NextResponse.json({
      ok: true,
      year: parsed.year,
      excelRows: parsed.rowCount,
      excelCells: parsed.cells.length,
      upserted: upserts.length,
      unmatchedCount: unmatchedNames.size,
      unmatchedExamples: Array.from(unmatchedNames).slice(0, 12),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
