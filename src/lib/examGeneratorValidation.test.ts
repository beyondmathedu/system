import { describe, expect, it } from "vitest";
import { examGeneratorMockRepository } from "@/lib/examGeneratorMockRepository";
import { createInitialExamGeneratorConfig } from "@/lib/examGeneratorTypes";
import { validateExamGeneratorConfig } from "@/lib/examGeneratorValidation";

describe("examGeneratorValidation", () => {
  it("flags mismatched MC totals", () => {
    const config = createInitialExamGeneratorConfig();
    config.paperType = "MC";
    config.topicMode = "specific";
    config.selectedTopics = ["Algebra", "Coordinate Geometry"];
    config.mc.totalQuestions = 10;
    config.mc.topicDistribution = { Algebra: 4, "Coordinate Geometry": 3 };
    config.mc.difficultyDistribution = { L1: 4, L2: 4, L3: 2 };

    const result = validateExamGeneratorConfig(config, examGeneratorMockRepository);
    expect(result.errors).toContain("Topic distribution must equal the total number of questions.");
    expect(result.canGenerate).toBe(false);
  });

  it("reports missing MC availability combinations", () => {
    const config = createInitialExamGeneratorConfig();
    config.paperType = "MC";
    config.topicMode = "specific";
    config.selectedTopics = ["Coordinate Geometry"];
    config.mc.totalQuestions = 13;
    config.mc.topicDistribution = { "Coordinate Geometry": 13 };
    config.mc.difficultyDistribution = { L1: 3, L2: 2, L3: 8 };

    const result = validateExamGeneratorConfig(config, examGeneratorMockRepository);
    expect(result.errors).toHaveLength(0);
    expect(result.availability?.ok).toBe(false);
    expect(result.availability?.missingRequirements.some((item) => item.label.includes("Coordinate Geometry + L3"))).toBe(
      true,
    );
  });

  it("allows a balanced LQ setup when counts exist", () => {
    const config = createInitialExamGeneratorConfig();
    config.paperType = "LQ";
    config.topicMode = "specific";
    config.selectedTopics = ["Algebra", "Coordinate Geometry"];
    config.lq.A.questionCount = 4;
    config.lq.A.topicDistribution = { Algebra: 2, "Coordinate Geometry": 2 };
    config.lq.A.difficultyDistribution = { L1: 2, L2: 2, L3: 0 };
    config.lq.B1.questionCount = 2;
    config.lq.B1.topicDistribution = { Algebra: 1, "Coordinate Geometry": 1 };
    config.lq.B1.difficultyDistribution = { L1: 0, L2: 1, L3: 1 };
    config.lq.B2.questionCount = 2;
    config.lq.B2.topicDistribution = { Algebra: 1, "Coordinate Geometry": 1 };
    config.lq.B2.difficultyDistribution = { L1: 0, L2: 1, L3: 1 };

    const result = validateExamGeneratorConfig(config, examGeneratorMockRepository);
    expect(result.errors).toHaveLength(0);
    expect(result.availability?.ok).toBe(true);
    expect(result.canGenerate).toBe(true);
  });
});
