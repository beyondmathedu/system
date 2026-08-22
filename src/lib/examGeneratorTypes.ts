export type ExamForm = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";
export type ExamPaperType = "MC" | "LQ";
export type TopicMode = "overall" | "specific";
export type QuestionSelectionMode = "overall" | "select_questions";
export type ExamDifficulty = "L1" | "L2" | "L3";
export type LqSection = "A" | "B1" | "B2";
export type QuestionBankStatus = "draft" | "pending_review" | "approved";

export type ExamGeneratorQuestion = {
  id: string;
  form: ExamForm;
  paper_type: ExamPaperType;
  subject: string;
  topic: string;
  subtopic: string | null;
  section: LqSection | null;
  difficulty: ExamDifficulty;
  marks: number;
  question_image_path: string | null;
  source: string;
  source_year: string;
  source_paper: string;
  source_question_number: string;
  status: QuestionBankStatus;
};

export type TopicOption = {
  topic: string;
  forms: ExamForm[];
  paperTypes: ExamPaperType[];
};

export type CountByTopic = Record<string, number>;
export type CountByDifficulty = Record<ExamDifficulty, number>;

export type McRequirements = {
  totalQuestions: number;
  topicDistribution: CountByTopic;
  difficultyDistribution: CountByDifficulty;
};

export type LqSectionRequirements = {
  questionCount: number;
  topicDistribution: CountByTopic;
  difficultyDistribution: CountByDifficulty;
};

export type LqRequirements = {
  A: LqSectionRequirements;
  B1: LqSectionRequirements;
  B2: LqSectionRequirements;
};

export type ExamGeneratorConfig = {
  form: ExamForm;
  paperType: ExamPaperType | null;
  topicMode: TopicMode;
  selectedTopics: string[];
  questionSelectionMode: QuestionSelectionMode;
  selectedQuestionIds: string[];
  mc: McRequirements;
  lq: LqRequirements;
};

export type AvailabilityRequirement = {
  key: string;
  label: string;
  required: number;
  available: number;
  missing: number;
};

export type AvailabilityCheckResult = {
  ok: boolean;
  missingRequirements: AvailabilityRequirement[];
  notes: string[];
};

export type ExamValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  availability: AvailabilityCheckResult | null;
  canGenerate: boolean;
};

export type ExamGeneratorRepository = {
  getSupportedForms(): ExamForm[];
  getTopics(input: { form?: ExamForm; paperType: ExamPaperType }): TopicOption[];
  searchQuestions(input: {
    form: ExamForm;
    paperType: ExamPaperType;
    topicQuery?: string;
    topics?: string[];
    section?: LqSection | "all";
    difficulty?: ExamDifficulty | "all";
    sourceQuery?: string;
    yearQuery?: string;
  }): ExamGeneratorQuestion[];
  getAvailabilityCounts(input: {
    form: ExamForm;
    paperType: ExamPaperType;
    topics: string[];
  }): {
    byTopic: CountByTopic;
    byDifficulty: CountByDifficulty;
    byTopicDifficulty: Record<string, number>;
    bySectionTopic: Record<string, number>;
    bySectionDifficulty: Record<string, number>;
    bySectionTopicDifficulty: Record<string, number>;
  };
};

export const EXAM_FORMS: ExamForm[] = ["F1", "F2", "F3", "F4", "F5", "F6"];
export const EXAM_DIFFICULTIES: ExamDifficulty[] = ["L1", "L2", "L3"];
export const LQ_SECTIONS: LqSection[] = ["A", "B1", "B2"];
export const PAPER_TYPES: ExamPaperType[] = ["LQ", "MC"];

export function emptyDifficultyCounts(): CountByDifficulty {
  return { L1: 0, L2: 0, L3: 0 };
}

export function createEmptyLqSectionRequirements(): LqSectionRequirements {
  return {
    questionCount: 0,
    topicDistribution: {},
    difficultyDistribution: emptyDifficultyCounts(),
  };
}

export function createInitialExamGeneratorConfig(): ExamGeneratorConfig {
  return {
    form: "F6",
    paperType: null,
    topicMode: "specific",
    selectedTopics: [],
    questionSelectionMode: "overall",
    selectedQuestionIds: [],
    mc: {
      totalQuestions: 30,
      topicDistribution: {},
      difficultyDistribution: { L1: 10, L2: 15, L3: 5 },
    },
    lq: {
      A: createEmptyLqSectionRequirements(),
      B1: createEmptyLqSectionRequirements(),
      B2: createEmptyLqSectionRequirements(),
    },
  };
}
