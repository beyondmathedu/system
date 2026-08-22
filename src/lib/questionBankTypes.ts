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

export type QuestionPdfSourceStatus = "uploaded" | "processing" | "ready" | "failed";
export type QuestionBankShelfStatus = "uploaded" | "needs_segmentation" | "segmented" | "needs_review" | "ready";

/** Bounding box as percentage of page dimensions (0–100). */
export type QuestionBBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type DraftQuestion = {
  clientId: string;
  pdfSourceId: string | null;
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

export type QuestionPdfSourceRow = {
  id: string;
  file_name: string;
  storage_path: string;
  page_count: number;
  status: QuestionPdfSourceStatus;
  created_at: string;
  updated_at: string;
  signed_pdf_url: string | null;
  saved_question_count: number;
  needs_review_count: number;
  ready_question_count: number;
  shelf_status: QuestionBankShelfStatus;
};

// Kept for backwards compatibility with older tests and UI copy.
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

export function deriveShelfStatus(input: {
  sourceStatus: QuestionPdfSourceStatus;
  savedQuestionCount: number;
  needsReviewCount: number;
}): QuestionBankShelfStatus {
  if (input.sourceStatus === "failed") return "needs_review";
  if (input.savedQuestionCount === 0) {
    return input.sourceStatus === "uploaded" ? "needs_segmentation" : "uploaded";
  }
  if (input.needsReviewCount > 0) return "needs_review";
  if (input.sourceStatus === "ready") return "ready";
  return "segmented";
}
