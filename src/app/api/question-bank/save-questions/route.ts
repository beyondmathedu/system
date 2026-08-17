import { NextResponse, type NextRequest } from "next/server";
import { requireQuestionBankAdmin } from "@/lib/questionBankAuth.server";
import type { QuestionDifficulty, QuestionProcessingStatus } from "@/lib/questionBankTypes";
import { allocateQuestionCodes, dataUrlToBuffer } from "@/lib/questionBankVision.server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const IMAGE_BUCKET = "question-assets";
const DIFFICULTIES = new Set<QuestionDifficulty>(["L1", "L2", "L3", "needs_review"]);
const PROCESSING_STATUSES = new Set<QuestionProcessingStatus>([
  "pending_review",
  "needs_review",
  "approved",
]);

type SaveQuestionInput = {
  pageNumber: number;
  questionLabel: string;
  subject?: string | null;
  topic?: string | null;
  subtopic?: string | null;
  sourceLabel?: string | null;
  sourceYear?: string | null;
  examType?: string | null;
  difficulty?: QuestionDifficulty | null;
  aiDifficulty?: QuestionDifficulty | null;
  aiDifficultyConfidence?: number | null;
  marks?: number | null;
  timeMinutes?: number | null;
  bbox: { top: number; left: number; width: number; height: number };
  imageDataUrl?: string | null;
  processingStatus?: QuestionProcessingStatus;
};

/** Save reviewed test-mode question regions into the question bank. */
export async function POST(request: NextRequest) {
  const auth = await requireQuestionBankAdmin();
  if (auth.error) return auth.error;

  let body: { pdfSourceId?: string; questions?: SaveQuestionInput[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const pdfSourceId = String(body.pdfSourceId ?? "").trim() || null;
  const items = Array.isArray(body.questions) ? body.questions : [];
  if (!items.length) {
    return NextResponse.json({ ok: false, error: "No questions to save" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const codes = await allocateQuestionCodes(items.length);
    const saved: string[] = [];

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      const questionId = crypto.randomUUID();
      const questionCode = codes[i]!;
      const pageNumber = Math.max(1, Math.floor(Number(item.pageNumber ?? 1)));
      const aiDifficulty = item.aiDifficulty && DIFFICULTIES.has(item.aiDifficulty) ? item.aiDifficulty : null;
      const difficulty =
        item.difficulty && DIFFICULTIES.has(item.difficulty) ? item.difficulty : aiDifficulty;
      const confidence =
        item.aiDifficultyConfidence != null && Number.isFinite(Number(item.aiDifficultyConfidence))
          ? Math.max(0, Math.min(1, Number(item.aiDifficultyConfidence)))
          : null;
      const needsReview =
        item.processingStatus === "needs_review" ||
        difficulty === "needs_review" ||
        confidence == null ||
        confidence < 0.6 ||
        !item.marks ||
        !item.sourceLabel;
      const processingStatus: QuestionProcessingStatus = needsReview ? "needs_review" : "pending_review";

      let imagePath: string | null = null;
      const imageDataUrl = String(item.imageDataUrl ?? "").trim();
      if (imageDataUrl.startsWith("data:image/")) {
        imagePath = `question-bank/${questionCode}/question.png`;
        const { buffer } = dataUrlToBuffer(imageDataUrl);
        const { error: uploadError } = await sb.storage.from(IMAGE_BUCKET).upload(imagePath, buffer, {
          contentType: "image/png",
          upsert: true,
        });
        if (uploadError) throw new Error(uploadError.message);
      }

      const { error: insertError } = await sb.from("questions").insert({
        id: questionId,
        question_code: questionCode,
        pdf_source_id: pdfSourceId,
        page_number: pageNumber,
        question_label: String(item.questionLabel ?? "").trim(),
        subject: String(item.subject ?? "Mathematics").trim() || "Mathematics",
        topic: String(item.topic ?? "").trim() || null,
        subtopic: String(item.subtopic ?? "").trim() || null,
        source_label: item.sourceLabel ? String(item.sourceLabel).trim() : null,
        source_year: item.sourceYear ? String(item.sourceYear).trim() : null,
        exam_type: item.examType ? String(item.examType).trim() : null,
        difficulty,
        ai_difficulty: aiDifficulty,
        ai_difficulty_confidence: confidence,
        difficulty_reviewed: false,
        marks: item.marks != null && Number(item.marks) > 0 ? Math.round(Number(item.marks)) : null,
        time_minutes:
          item.timeMinutes != null && Number(item.timeMinutes) > 0
            ? Math.round(Number(item.timeMinutes))
            : null,
        image_path: imagePath,
        bbox_json: item.bbox ?? null,
        processing_status: PROCESSING_STATUSES.has(processingStatus) ? processingStatus : "pending_review",
        updated_at: new Date().toISOString(),
      });
      if (insertError) throw new Error(insertError.message);
      saved.push(questionId);
    }

    if (pdfSourceId) {
      await sb
        .from("question_pdf_sources")
        .update({ status: "ready", updated_at: new Date().toISOString() })
        .eq("id", pdfSourceId);
    }

    return NextResponse.json({ ok: true, savedCount: saved.length, questionIds: saved, questionCodes: codes });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
