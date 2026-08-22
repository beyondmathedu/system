import { NextResponse, type NextRequest } from "next/server";
import { requireQuestionBankAdmin } from "@/lib/questionBankAuth.server";
import { detectQuestionsOnPage } from "@/lib/questionBankVision.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** AI vision: detect question bounding boxes on one PDF page image (Test Mode). */
export async function POST(request: NextRequest) {
  const auth = await requireQuestionBankAdmin();
  if (auth.error) return auth.error;

  let body: {
    pageNumber?: number;
    imageDataUrl?: string;
    defaultSubject?: string;
    defaultTopic?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const pageNumber = Math.max(1, Math.floor(Number(body.pageNumber ?? 1)));
  const imageDataUrl = String(body.imageDataUrl ?? "").trim();
  if (!imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ ok: false, error: "imageDataUrl required" }, { status: 400 });
  }

  try {
    const result = await detectQuestionsOnPage({
      pageNumber,
      imageDataUrl,
      defaultSubject: body.defaultSubject,
      defaultTopic: body.defaultTopic,
    });
    return NextResponse.json({
      ok: true,
      pageNumber,
      regions: result.questions,
      questions: result.questions,
      usedAi: result.usedAi,
      note: result.note,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analysis failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
