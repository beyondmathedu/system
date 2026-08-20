import { NextResponse, type NextRequest } from "next/server";
import { requireQuestionBankAdmin } from "@/lib/questionBankAuth.server";
import { formatQuestionBankDbError } from "@/lib/questionBankSchema.server";
import { QUESTION_BANK_PDF_BUCKET, ensureQuestionBankStorageBuckets } from "@/lib/questionBankStorage.server";
import { deriveShelfStatus, type QuestionPdfSourceRow, type QuestionPdfSourceStatus } from "@/lib/questionBankTypes";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireQuestionBankAdmin();
  if (auth.error) return auth.error;

  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "100")));

  try {
    const sb = getSupabaseAdmin();
    await ensureQuestionBankStorageBuckets(sb);

    const { data: sourceRows, error: sourceError } = await sb
      .from("question_pdf_sources")
      .select("id, file_name, storage_path, page_count, status, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (sourceError) throw new Error(formatQuestionBankDbError(sourceError.message));

    const sourceIds = (sourceRows ?? []).map((row) => String(row.id));
    const { data: questionRows, error: questionError } = sourceIds.length
      ? await sb
          .from("questions")
          .select("pdf_source_id, processing_status")
          .in("pdf_source_id", sourceIds)
      : { data: [], error: null };
    if (questionError) throw new Error(formatQuestionBankDbError(questionError.message));

    const countsBySource = new Map<
      string,
      { savedQuestionCount: number; needsReviewCount: number; readyQuestionCount: number }
    >();
    for (const row of questionRows ?? []) {
      const sourceId = String(row.pdf_source_id ?? "");
      if (!sourceId) continue;
      const current = countsBySource.get(sourceId) ?? {
        savedQuestionCount: 0,
        needsReviewCount: 0,
        readyQuestionCount: 0,
      };
      current.savedQuestionCount += 1;
      if (row.processing_status === "needs_review") current.needsReviewCount += 1;
      else current.readyQuestionCount += 1;
      countsBySource.set(sourceId, current);
    }

    const storagePaths = (sourceRows ?? []).map((row) => String(row.storage_path ?? "")).filter(Boolean);
    const signedResult = storagePaths.length
      ? await sb.storage.from(QUESTION_BANK_PDF_BUCKET).createSignedUrls(storagePaths, 3600)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    const signedUrlByPath = new Map(
      (signedResult.data ?? []).map((item) => [String(item.path ?? ""), item.signedUrl] as const),
    );

    const sources: QuestionPdfSourceRow[] = (sourceRows ?? []).map((row) => {
      const counts = countsBySource.get(String(row.id)) ?? {
        savedQuestionCount: 0,
        needsReviewCount: 0,
        readyQuestionCount: 0,
      };
      const sourceStatus = String(row.status ?? "uploaded") as QuestionPdfSourceStatus;
      return {
        id: String(row.id),
        file_name: String(row.file_name ?? ""),
        storage_path: String(row.storage_path ?? ""),
        page_count: Math.max(0, Number(row.page_count ?? 0)),
        status: sourceStatus,
        created_at: String(row.created_at ?? ""),
        updated_at: String(row.updated_at ?? row.created_at ?? ""),
        signed_pdf_url: signedUrlByPath.get(String(row.storage_path ?? "")) ?? null,
        saved_question_count: counts.savedQuestionCount,
        needs_review_count: counts.needsReviewCount,
        ready_question_count: counts.readyQuestionCount,
        shelf_status: deriveShelfStatus({
          sourceStatus,
          savedQuestionCount: counts.savedQuestionCount,
          needsReviewCount: counts.needsReviewCount,
        }),
      };
    });

    return NextResponse.json({ ok: true, sources });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Failed to load sources";
    return NextResponse.json({ ok: false, error: formatQuestionBankDbError(raw) }, { status: 500 });
  }
}
