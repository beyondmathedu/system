export type QuestionDifficulty = "L1" | "L2" | "L3" | "needs_review";

export type QuestionProcessingStatus =
  | "uploaded"
  | "processing"
  | "segmented"
  | "metadata_extracted"
  | "ai_classified"
  | "pending_review"
  | "approved"
  | "needs_review"
  | "failed";

/** Bounding box as percentage of page dimensions (0–100). */
export type QuestionBBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type DraftQuestion = {
  clientId: string;
  pageNumber: number;
  questionLabel: string;
  subject: string;
  topic: string;
  subtopic: string;
  sourceLabel: string | null;
  sourceYear: string | null;
  examType: string | null;
  difficulty: QuestionDifficulty;
  aiDifficulty: QuestionDifficulty | null;
  aiDifficultyConfidence: number | null;
  marks: number | null;
  timeMinutes: number | null;
  bbox: QuestionBBox;
  previewDataUrl: string;
  processingStatus: QuestionProcessingStatus;
  approved: boolean;
};

export type AiDetectedQuestion = {
  questionLabel: string;
  top: number;
  left: number;
  width: number;
  height: number;
  suggestedDifficulty: QuestionDifficulty;
  suggestedMarks: number | null;
  suggestedTopic: string;
  suggestedSubtopic: string;
  sourceLabel: string | null;
  sourceYear: string | null;
  examType: string | null;
  aiDifficultyConfidence: number | null;
  needsReview: boolean;
};

export type QuestionRow = {
  id: string;
  question_code: string | null;
  pdf_source_id: string | null;
  page_number: number;
  question_label: string;
  subject: string | null;
  topic: string | null;
  subtopic: string | null;
  source_label: string | null;
  source_year: string | null;
  exam_type: string | null;
  difficulty: QuestionDifficulty | null;
  ai_difficulty: QuestionDifficulty | null;
  ai_difficulty_confidence: number | null;
  difficulty_reviewed: boolean;
  marks: number | null;
  time_minutes: number | null;
  image_path: string | null;
  bbox_json: QuestionBBox | null;
  processing_status: QuestionProcessingStatus;
  created_at: string;
};

export const TEST_MODE_MAX_PAGES = 3;

export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function normalizeBBox(raw: Partial<QuestionBBox> | null | undefined): QuestionBBox {
  const top = clampPercent(Number(raw?.top ?? 0));
  const left = clampPercent(Number(raw?.left ?? 0));
  const width = clampPercent(Number(raw?.width ?? 100));
  const height = clampPercent(Number(raw?.height ?? 100));
  return {
    top,
    left,
    width: Math.min(width, 100 - left),
    height: Math.min(height, 100 - top),
  };
}

export function newClientId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function parseDifficulty(raw: unknown): QuestionDifficulty {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "L1" || v === "L2" || v === "L3") return v;
  if (v === "NEEDS_REVIEW" || v === "NEEDS REVIEW") return "needs_review";
  return "needs_review";
}

export function parseConfidence(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}
