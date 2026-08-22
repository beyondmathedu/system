import {
  EXAM_DIFFICULTIES,
  type CountByDifficulty,
  type CountByTopic,
  type ExamDifficulty,
  type ExamForm,
  type ExamGeneratorQuestion,
  type ExamGeneratorRepository,
  type ExamPaperType,
  type LqSection,
  type TopicOption,
} from "@/lib/examGeneratorTypes";

const F6_LQ_TOPICS = [
  "3D Trigonometry",
  "Arithmetic, Geometric Sequence",
  "Coordinate Geometry",
  "Exponential and Logarithmise",
  "Factorization, Basic Equation Solving",
  "Geometry",
  "Graph of Function",
  "Inequality",
  "Linear Programming",
  "Mensuration",
  "More about Polynomial",
];
const F6_MC_TOPICS = [...F6_LQ_TOPICS];
const LQ_SECTIONS: LqSection[] = ["A", "B1", "B2"];

const MC_AVAILABILITY: Record<string, CountByDifficulty> = {
  "3D Trigonometry": { L1: 6, L2: 7, L3: 3 },
  "Arithmetic, Geometric Sequence": { L1: 7, L2: 6, L3: 3 },
  "Coordinate Geometry": { L1: 5, L2: 5, L3: 2 },
  "Exponential and Logarithmise": { L1: 5, L2: 4, L3: 2 },
  "Factorization, Basic Equation Solving": { L1: 8, L2: 7, L3: 3 },
  Geometry: { L1: 7, L2: 6, L3: 2 },
  "Graph of Function": { L1: 6, L2: 5, L3: 3 },
  Inequality: { L1: 5, L2: 4, L3: 2 },
  "Linear Programming": { L1: 4, L2: 4, L3: 2 },
  Mensuration: { L1: 6, L2: 5, L3: 2 },
  "More about Polynomial": { L1: 5, L2: 5, L3: 3 },
};

const LQ_AVAILABILITY: Record<LqSection, Record<string, CountByDifficulty>> = {
  A: {
    "3D Trigonometry": { L1: 2, L2: 2, L3: 1 },
    "Arithmetic, Geometric Sequence": { L1: 4, L2: 3, L3: 1 },
    "Coordinate Geometry": { L1: 6, L2: 4, L3: 1 },
    "Exponential and Logarithmise": { L1: 3, L2: 2, L3: 1 },
    "Factorization, Basic Equation Solving": { L1: 5, L2: 4, L3: 1 },
    Geometry: { L1: 5, L2: 3, L3: 1 },
    "Graph of Function": { L1: 4, L2: 3, L3: 1 },
    Inequality: { L1: 3, L2: 2, L3: 1 },
    "Linear Programming": { L1: 2, L2: 2, L3: 1 },
    Mensuration: { L1: 4, L2: 3, L3: 1 },
    "More about Polynomial": { L1: 3, L2: 3, L3: 1 },
  },
  B1: {
    "3D Trigonometry": { L1: 1, L2: 3, L3: 2 },
    "Arithmetic, Geometric Sequence": { L1: 1, L2: 3, L3: 2 },
    "Coordinate Geometry": { L1: 1, L2: 3, L3: 2 },
    "Exponential and Logarithmise": { L1: 1, L2: 2, L3: 2 },
    "Factorization, Basic Equation Solving": { L1: 1, L2: 3, L3: 2 },
    Geometry: { L1: 1, L2: 3, L3: 2 },
    "Graph of Function": { L1: 1, L2: 3, L3: 2 },
    Inequality: { L1: 1, L2: 2, L3: 2 },
    "Linear Programming": { L1: 1, L2: 2, L3: 2 },
    Mensuration: { L1: 1, L2: 3, L3: 2 },
    "More about Polynomial": { L1: 1, L2: 3, L3: 2 },
  },
  B2: {
    "3D Trigonometry": { L1: 0, L2: 2, L3: 3 },
    "Arithmetic, Geometric Sequence": { L1: 0, L2: 2, L3: 2 },
    "Coordinate Geometry": { L1: 0, L2: 2, L3: 3 },
    "Exponential and Logarithmise": { L1: 0, L2: 2, L3: 2 },
    "Factorization, Basic Equation Solving": { L1: 0, L2: 2, L3: 2 },
    Geometry: { L1: 0, L2: 2, L3: 3 },
    "Graph of Function": { L1: 0, L2: 2, L3: 3 },
    Inequality: { L1: 0, L2: 2, L3: 2 },
    "Linear Programming": { L1: 0, L2: 2, L3: 2 },
    Mensuration: { L1: 0, L2: 2, L3: 3 },
    "More about Polynomial": { L1: 0, L2: 2, L3: 2 },
  },
};

function pushQuestion(
  out: ExamGeneratorQuestion[],
  input: {
    form: ExamForm;
    paperType: ExamPaperType;
    topic: string;
    difficulty: ExamDifficulty;
    count: number;
    section: LqSection | null;
  },
) {
  for (let i = 1; i <= input.count; i += 1) {
    const suffix = `${input.topic}-${input.difficulty}-${input.section ?? "MC"}-${i}`;
    out.push({
      id: `${input.form}-${input.paperType}-${suffix}`.replace(/\s+/g, "-").toLowerCase(),
      form: input.form,
      paper_type: input.paperType,
      subject: "Mathematics",
      topic: input.topic,
      subtopic: null,
      section: input.section,
      difficulty: input.difficulty,
      marks: input.paperType === "MC" ? 1 : input.section === "A" ? 4 : 8,
      question_image_path: null,
      source: "Mock Question Data",
      source_year: "2024",
      source_paper: input.paperType === "MC" ? "Mock MC Paper" : `Mock LQ Section ${input.section ?? ""}`.trim(),
      source_question_number: String(i),
      status: "approved",
    });
  }
}

function buildMockQuestions(): ExamGeneratorQuestion[] {
  const out: ExamGeneratorQuestion[] = [];
  for (const [topic, diffCounts] of Object.entries(MC_AVAILABILITY)) {
    for (const difficulty of EXAM_DIFFICULTIES) {
      pushQuestion(out, {
        form: "F6",
        paperType: "MC",
        topic,
        difficulty,
        count: diffCounts[difficulty],
        section: null,
      });
    }
  }
  for (const section of LQ_SECTIONS) {
    for (const [topic, diffCounts] of Object.entries(LQ_AVAILABILITY[section])) {
      for (const difficulty of EXAM_DIFFICULTIES) {
        pushQuestion(out, {
          form: "F6",
          paperType: "LQ",
          topic,
          difficulty,
          count: diffCounts[difficulty],
          section,
        });
      }
    }
  }
  return out;
}

const MOCK_QUESTIONS = buildMockQuestions();

function sumTopicAvailability(rows: ExamGeneratorQuestion[]): CountByTopic {
  const out: CountByTopic = {};
  for (const row of rows) out[row.topic] = (out[row.topic] ?? 0) + 1;
  return out;
}

function sumDifficultyAvailability(rows: ExamGeneratorQuestion[]): CountByDifficulty {
  const out: CountByDifficulty = { L1: 0, L2: 0, L3: 0 };
  for (const row of rows) out[row.difficulty] += 1;
  return out;
}

function sumByKey(rows: ExamGeneratorQuestion[], keyFn: (row: ExamGeneratorQuestion) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

const TOPIC_OPTIONS: TopicOption[] = [
  ...F6_MC_TOPICS.map((topic) => ({ topic, forms: ["F6"] as ExamForm[], paperTypes: ["MC"] as ExamPaperType[] })),
  ...F6_LQ_TOPICS.map((topic) => ({ topic, forms: ["F6"] as ExamForm[], paperTypes: ["LQ"] as ExamPaperType[] })),
];

export const examGeneratorMockRepository: ExamGeneratorRepository = {
  getSupportedForms() {
    return ["F6"];
  },

  getTopics({ form, paperType }) {
    return TOPIC_OPTIONS.filter((option) => option.paperTypes.includes(paperType) && (!form || option.forms.includes(form)));
  },

  searchQuestions(input) {
    return MOCK_QUESTIONS.filter((row) => {
      if (row.form !== input.form) return false;
      if (row.paper_type !== input.paperType) return false;
      if (input.topics?.length && !input.topics.includes(row.topic)) return false;
      if (input.section && input.section !== "all" && row.section !== input.section) return false;
      if (input.difficulty && input.difficulty !== "all" && row.difficulty !== input.difficulty) return false;
      if (input.topicQuery && !`${row.topic} ${row.subtopic ?? ""}`.toLowerCase().includes(input.topicQuery.toLowerCase())) {
        return false;
      }
      if (input.sourceQuery && !row.source.toLowerCase().includes(input.sourceQuery.toLowerCase())) return false;
      if (input.yearQuery && !row.source_year.toLowerCase().includes(input.yearQuery.toLowerCase())) return false;
      return true;
    });
  },

  getAvailabilityCounts({ form, paperType, topics }) {
    const rows = MOCK_QUESTIONS.filter((row) => {
      if (row.form !== form) return false;
      if (row.paper_type !== paperType) return false;
      if (topics.length && !topics.includes(row.topic)) return false;
      return true;
    });

    return {
      byTopic: sumTopicAvailability(rows),
      byDifficulty: sumDifficultyAvailability(rows),
      byTopicDifficulty: sumByKey(rows, (row) => `${row.topic}__${row.difficulty}`),
      bySectionTopic: sumByKey(rows, (row) => `${row.section ?? "MC"}__${row.topic}`),
      bySectionDifficulty: sumByKey(rows, (row) => `${row.section ?? "MC"}__${row.difficulty}`),
      bySectionTopicDifficulty: sumByKey(rows, (row) => `${row.section ?? "MC"}__${row.topic}__${row.difficulty}`),
    };
  },
};
