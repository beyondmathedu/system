import { NextResponse, type NextRequest } from "next/server";
import { requireQuestionBankAdmin } from "@/lib/questionBankAuth.server";
import type { QuestionDifficulty, QuestionProcessingStatus } from "@/lib/questionBankTypes";
import { allocateQuestionCodes, dataUrlToBuffer } from "@/lib/questionBankVision.server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const IMAGE_BUCKET = "question-assets";
const DIFFICULTIES = new Set<QuestionDifficulty>(["L1", "L2", "L3", "needs_review"]);

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

/** List saved questions (default: pending_review + needs_review). */
export async function GET(request: NextRequest) {
  const auth = await requireQuestionBankAdmin();
  if (auth.error) return auth.error;

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status");
  const difficulty = sp.get("difficulty");
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit") ?? "50")));

  try {
    const sb = getSupabaseAdmin();
    let query = sb
      .from("questions")
      .select(
        "id, question_code, pdf_source_id, page_number, question_label, subject, topic, subtopic, source_label, source_year, exam_type, difficulty, ai_difficulty, ai_difficulty_confidence, difficulty_reviewed, marks, time_minutes, image_path, processing_status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("processing_status", status);
    } else {
      query = query.in("processing_status", ["pending_review", "needs_review"]);
    }
    if (difficulty && DIFFICULTIES.has(difficulty as QuestionDifficulty)) {
      query = query.eq("difficulty", difficulty);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const paths = rows.map((r) => String((r as { image_path?: string }).image_path ?? "")).filter(Boolean);
    const signed = paths.length
      ? await sb.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 3600)
      : { data: [] as { path: string | null; signedUrl: string }[] };

    const urlByPath = new Map(
      (signed.data ?? []).map((item) => [String(item.path ?? ""), item.signedUrl] as const),
    );

    const questions = rows.map((row) => ({
      ...row,
      image_url: urlByPath.get(String((row as { image_path?: string }).image_path ?? "")) ?? null,
    }));

    return NextResponse.json({ ok: true, questions });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load questions";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Back-compat save endpoint. */
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
      const imageDataUrl = String(item.imageDataUrl ?? "").trim();
      let imagePath: string | null = null;
      if (imageDataUrl.startsWith("data:image/")) {
        imagePath = `question-bank/${questionCode}/question.png`;
        const { buffer } = dataUrlToBuffer(imageDataUrl);
        const { error: uploadError } = await sb.storage.from(IMAGE_BUCKET).upload(imagePath, buffer, {
          contentType: "image/png",
          upsert: true,
        });
        if (uploadError) throw new Error(uploadError.message);
      }

      const aiDifficulty = item.aiDifficulty && DIFFICULTIES.has(item.aiDifficulty) ? item.aiDifficulty : null;
      const difficulty =
        item.difficulty && DIFFICULTIES.has(item.difficulty) ? item.difficulty : aiDifficulty;
      const confidence =
        item.aiDifficultyConfidence != null && Number.isFinite(Number(item.aiDifficultyConfidence))
          ? Math.max(0, Math.min(1, Number(item.aiDifficultyConfidence)))
          : null;
      const needsReview =
        !item.marks || !item.sourceLabel || difficulty === "needs_review" || confidence == null || confidence < 0.6;

      const { error: insertError } = await sb.from("questions").insert({
        id: questionId,
        question_code: questionCode,
        pdf_source_id: pdfSourceId,
        page_number: Math.max(1, Math.floor(Number(item.pageNumber ?? 1))),
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
        processing_status: needsReview ? "needs_review" : "pending_review",
        updated_at: new Date().toISOString(),
      });
      if (insertError) throw new Error(insertError.message);
      saved.push(questionId);
    }

    return NextResponse.json({ ok: true, savedCount: saved.length, questionIds: saved, questionCodes: codes });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
