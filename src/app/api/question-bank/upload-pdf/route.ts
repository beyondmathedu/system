import { NextResponse, type NextRequest } from "next/server";
import { requireQuestionBankAdmin } from "@/lib/questionBankAuth.server";
import {
  ensureQuestionBankStorageBuckets,
  formatStorageUploadError,
  QUESTION_BANK_PDF_BUCKET,
} from "@/lib/questionBankStorage.server";
import { formatQuestionBankDbError } from "@/lib/questionBankSchema.server";
import { dataUrlToBuffer } from "@/lib/questionBankVision.server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** Upload PDF source file to Storage and record metadata. */
export async function POST(request: NextRequest) {
  const auth = await requireQuestionBankAdmin();
  if (auth.error) return auth.error;

  let body: { fileName?: string; pdfDataUrl?: string; pageCount?: number; totalPageCount?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const fileName = String(body.fileName ?? "upload.pdf").trim() || "upload.pdf";
  const pdfDataUrl = String(body.pdfDataUrl ?? "").trim();
  const pageCount = Math.max(0, Math.floor(Number(body.pageCount ?? body.totalPageCount ?? 0)));
  if (!pdfDataUrl.startsWith("data:application/pdf")) {
    return NextResponse.json({ ok: false, error: "pdfDataUrl must be a PDF data URL" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    await ensureQuestionBankStorageBuckets(sb);
    const { buffer } = dataUrlToBuffer(pdfDataUrl);
    const sourceId = crypto.randomUUID();
    const storagePath = `pdf-sources/${sourceId}/${fileName.replace(/[^\w.\-()]+/g, "_")}`;

    const { error: uploadError } = await sb.storage.from(QUESTION_BANK_PDF_BUCKET).upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (uploadError) {
      throw new Error(formatStorageUploadError(QUESTION_BANK_PDF_BUCKET, uploadError.message));
    }

    const { data, error } = await sb
      .from("question_pdf_sources")
      .insert({
        id: sourceId,
        file_name: fileName,
        storage_path: storagePath,
        page_count: pageCount,
        status: "uploaded",
        uploaded_by: auth.viewer!.userId,
        updated_at: new Date().toISOString(),
      })
      .select("id, file_name, storage_path, page_count, status, created_at")
      .single();
    if (error) throw new Error(formatQuestionBankDbError(error.message));

    return NextResponse.json({ ok: true, source: data });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Upload failed";
    const message = formatQuestionBankDbError(raw);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
