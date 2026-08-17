import "server-only";

import type { AiDetectedQuestion } from "@/lib/questionBankTypes";
import { normalizeBBox, parseConfidence, parseDifficulty } from "@/lib/questionBankTypes";

function fallbackFullPage(pageNumber: number): AiDetectedQuestion[] {
  return [
    {
      questionLabel: `P${pageNumber}`,
      top: 2,
      left: 2,
      width: 96,
      height: 96,
      suggestedDifficulty: "needs_review",
      suggestedMarks: null,
      suggestedTopic: "",
      suggestedSubtopic: "",
      sourceLabel: null,
      sourceYear: null,
      examType: null,
      aiDifficultyConfidence: null,
      needsReview: true,
    },
  ];
}

function parseAiJson(text: string, pageNumber: number): AiDetectedQuestion[] {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return fallbackFullPage(pageNumber);

  let parsed: { questions?: unknown[] };
  try {
    parsed = JSON.parse(jsonMatch[0]) as { questions?: unknown[] };
  } catch {
    return fallbackFullPage(pageNumber);
  }

  const rows = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (!rows.length) return fallbackFullPage(pageNumber);

  return rows.map((row, idx) => {
    const r = row as Record<string, unknown>;
    const box = normalizeBBox({
      top: Number(r.top ?? r.topPercent ?? 0),
      left: Number(r.left ?? r.leftPercent ?? 0),
      width: Number(r.width ?? r.widthPercent ?? 100),
      height: Number(r.height ?? r.heightPercent ?? 20),
    });
    const suggestedMarksRaw = r.suggestedMarks ?? r.marks;
    const suggestedMarks =
      suggestedMarksRaw == null || suggestedMarksRaw === ""
        ? null
        : Math.max(1, Math.round(Number(suggestedMarksRaw)));
    const confidence = parseConfidence(r.aiDifficultyConfidence ?? r.confidence);
    const suggestedDifficulty = parseDifficulty(r.suggestedDifficulty ?? r.difficulty ?? r.ai_difficulty);
    const needsReview = Boolean(r.needsReview) || suggestedDifficulty === "needs_review" || confidence == null || confidence < 0.6;

    return {
      questionLabel: String(r.questionLabel ?? r.question_number ?? r.label ?? `${idx + 1}`).trim(),
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
      suggestedDifficulty: needsReview ? "needs_review" : suggestedDifficulty,
      suggestedMarks,
      suggestedTopic: String(r.suggestedTopic ?? r.topic ?? "").trim(),
      suggestedSubtopic: String(r.suggestedSubtopic ?? r.subtopic ?? "").trim(),
      sourceLabel: String(r.sourceLabel ?? r.source_label ?? "").trim() || null,
      sourceYear: String(r.sourceYear ?? r.source_year ?? "").trim() || null,
      examType: String(r.examType ?? r.exam_type ?? "").trim() || null,
      aiDifficultyConfidence: confidence,
      needsReview,
    };
  });
}

export async function detectQuestionsOnPage(input: {
  pageNumber: number;
  imageDataUrl: string;
  defaultSubject?: string;
  defaultTopic?: string;
}): Promise<{ questions: AiDetectedQuestion[]; usedAi: boolean; note: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      questions: fallbackFullPage(input.pageNumber),
      usedAi: false,
      note: "OPENAI_API_KEY not set — using full-page placeholder. Set the key to enable AI splitting.",
    };
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });

  const prompt = `You analyze Hong Kong secondary school math exam paper page images.
Detect each separate question region on this page. Return ONLY valid JSON:
{
  "questions": [
    {
      "questionLabel": "7",
      "top": 8,
      "left": 5,
      "width": 90,
      "height": 22,
      "suggestedDifficulty": "L2",
      "suggestedMarks": 5,
      "suggestedTopic": "Coordinate Geometry",
      "suggestedSubtopic": "",
      "sourceLabel": "Set Z/23-24/S6 Mock/I/Q7",
      "sourceYear": "2023-24",
      "examType": "S6 Mock",
      "aiDifficultyConfidence": 0.87,
      "needsReview": false
    }
  ]
}
Rules:
- top/left/width/height are percentages (0-100) of the page image.
- One page may contain multiple independent questions; do NOT treat the whole page as one question unless it truly is one question.
- Boxes must include the full question stem, diagrams, sub-parts (a)(b), and marks text.
- suggestedDifficulty must be L1, L2, L3, or needs_review.
- If marks, sourceLabel, sourceYear, or examType cannot be read reliably, use null and set needsReview=true.
- Do NOT invent metadata.
- If the page is blank or only instructions, return {"questions":[]}.
Subject hint: ${input.defaultSubject ?? "Mathematics"}
Topic hint: ${input.defaultTopic ?? ""}
Page number: ${input.pageNumber}.`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: input.imageDataUrl, detail: "high" } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const text = response.choices[0]?.message?.content ?? "";
    const questions = parseAiJson(text, input.pageNumber);
    if (!questions.length) {
      return {
        questions: fallbackFullPage(input.pageNumber),
        usedAi: true,
        note: "AI found no questions on this page — using full-page placeholder.",
      };
    }
    return { questions, usedAi: true, note: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vision API failed";
    return {
      questions: fallbackFullPage(input.pageNumber),
      usedAi: false,
      note: message,
    };
  }
}

export function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid data URL");
  return { mime: m[1]!, buffer: Buffer.from(m[2]!, "base64") };
}

export async function allocateQuestionCodes(count: number): Promise<string[]> {
  const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
  const sb = getSupabaseAdmin();
  const { count: existingCount, error } = await sb
    .from("questions")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  const start = (existingCount ?? 0) + 1;
  return Array.from({ length: count }, (_, i) => `Q${String(start + i).padStart(3, "0")}`);
}
