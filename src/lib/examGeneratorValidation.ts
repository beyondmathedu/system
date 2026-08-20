import {
  EXAM_DIFFICULTIES,
  LQ_SECTIONS,
  type AvailabilityCheckResult,
  type AvailabilityRequirement,
  type CountByDifficulty,
  type ExamDifficulty,
  type ExamGeneratorConfig,
  type ExamGeneratorRepository,
  type ExamValidationResult,
  type ExamPaperType,
  type LqSection,
} from "@/lib/examGeneratorTypes";

function sumCounts(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function clampCount(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function selectedTopicsForConfig(
  config: ExamGeneratorConfig,
  repository: ExamGeneratorRepository,
  paperType: ExamPaperType,
): string[] {
  if (config.topicMode === "specific" && config.selectedTopics.length) return config.selectedTopics;
  return repository.getTopics({ form: config.form, paperType }).map((item) => item.topic);
}

type FlowEdge = { to: number; rev: number; cap: number; originalCap: number };

function addEdge(graph: FlowEdge[][], from: number, to: number, cap: number) {
  const fwd: FlowEdge = { to, rev: graph[to]!.length, cap, originalCap: cap };
  const rev: FlowEdge = { to: from, rev: graph[from]!.length, cap: 0, originalCap: 0 };
  graph[from]!.push(fwd);
  graph[to]!.push(rev);
}

function maxFlow(graph: FlowEdge[][], source: number, sink: number): number {
  let total = 0;
  while (true) {
    const prevNode = new Array<number>(graph.length).fill(-1);
    const prevEdge = new Array<number>(graph.length).fill(-1);
    const queue: number[] = [source];
    prevNode[source] = source;

    for (let i = 0; i < queue.length; i += 1) {
      const node = queue[i]!;
      for (let edgeIdx = 0; edgeIdx < graph[node]!.length; edgeIdx += 1) {
        const edge = graph[node]![edgeIdx]!;
        if (prevNode[edge.to] !== -1 || edge.cap <= 0) continue;
        prevNode[edge.to] = node;
        prevEdge[edge.to] = edgeIdx;
        queue.push(edge.to);
      }
    }

    if (prevNode[sink] === -1) return total;

    let aug = Number.POSITIVE_INFINITY;
    for (let node = sink; node !== source; node = prevNode[node]!) {
      const edge = graph[prevNode[node]!]![prevEdge[node]!]!;
      aug = Math.min(aug, edge.cap);
    }
    for (let node = sink; node !== source; node = prevNode[node]!) {
      const edge = graph[prevNode[node]!]![prevEdge[node]!]!;
      edge.cap -= aug;
      graph[edge.to]![edge.rev]!.cap += aug;
    }
    total += aug;
  }
}

function evaluateTopicDifficultyFeasibility(input: {
  topics: string[];
  topicDistribution: Record<string, number>;
  difficultyDistribution: CountByDifficulty;
  capacities: Record<string, number>;
}): AvailabilityRequirement[] {
  const topics = input.topics.filter(Boolean);
  const totalRequired = sumCounts(input.topicDistribution);
  if (!topics.length || totalRequired === 0) return [];

  const topicStart = 1;
  const diffStart = topicStart + topics.length;
  const sink = diffStart + EXAM_DIFFICULTIES.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);

  topics.forEach((topic, idx) => addEdge(graph, 0, topicStart + idx, clampCount(input.topicDistribution[topic] ?? 0)));
  EXAM_DIFFICULTIES.forEach((difficulty, idx) =>
    addEdge(graph, diffStart + idx, sink, clampCount(input.difficultyDistribution[difficulty] ?? 0)),
  );
  topics.forEach((topic, topicIdx) => {
    EXAM_DIFFICULTIES.forEach((difficulty, diffIdx) => {
      addEdge(
        graph,
        topicStart + topicIdx,
        diffStart + diffIdx,
        clampCount(input.capacities[`${topic}__${difficulty}`] ?? 0),
      );
    });
  });

  const flow = maxFlow(graph, 0, sink);
  if (flow >= totalRequired) return [];

  const topicRemaining = new Map<string, number>();
  topics.forEach((topic, idx) => {
    const edge = graph[0]!.find((candidate) => candidate.to === topicStart + idx);
    topicRemaining.set(topic, edge?.cap ?? 0);
  });

  const difficultyRemaining = new Map<ExamDifficulty, number>();
  EXAM_DIFFICULTIES.forEach((difficulty, idx) => {
    const edge = graph[diffStart + idx]!.find((candidate) => candidate.to === sink);
    difficultyRemaining.set(difficulty, edge?.cap ?? 0);
  });

  const requirements: AvailabilityRequirement[] = [];
  for (const topic of topics) {
    for (const difficulty of EXAM_DIFFICULTIES) {
      const missing = Math.min(topicRemaining.get(topic) ?? 0, difficultyRemaining.get(difficulty) ?? 0);
      if (missing <= 0) continue;
      const available = clampCount(input.capacities[`${topic}__${difficulty}`] ?? 0);
      requirements.push({
        key: `${topic}__${difficulty}`,
        label: `${topic} + ${difficulty}`,
        required: available + missing,
        available,
        missing,
      });
    }
  }

  return requirements.length
    ? requirements
    : [
        {
          key: "overall_topic_difficulty",
          label: "Topic and difficulty combination availability",
          required: totalRequired,
          available: flow,
          missing: totalRequired - flow,
        },
      ];
}

function buildMcAvailability(
  config: ExamGeneratorConfig,
  repository: ExamGeneratorRepository,
  topics: string[],
): AvailabilityCheckResult {
  const counts = repository.getAvailabilityCounts({ form: config.form, paperType: "MC", topics });
  const missingRequirements: AvailabilityRequirement[] = [];

  for (const topic of topics) {
    const required = clampCount(config.mc.topicDistribution[topic] ?? 0);
    if (!required) continue;
    const available = clampCount(counts.byTopic[topic] ?? 0);
    if (available < required) {
      missingRequirements.push({
        key: `topic__${topic}`,
        label: topic,
        required,
        available,
        missing: required - available,
      });
    }
  }

  for (const difficulty of EXAM_DIFFICULTIES) {
    const required = clampCount(config.mc.difficultyDistribution[difficulty] ?? 0);
    if (!required) continue;
    const available = clampCount(counts.byDifficulty[difficulty] ?? 0);
    if (available < required) {
      missingRequirements.push({
        key: `difficulty__${difficulty}`,
        label: `Difficulty ${difficulty}`,
        required,
        available,
        missing: required - available,
      });
    }
  }

  missingRequirements.push(
    ...evaluateTopicDifficultyFeasibility({
      topics,
      topicDistribution: config.mc.topicDistribution,
      difficultyDistribution: config.mc.difficultyDistribution,
      capacities: counts.byTopicDifficulty,
    }),
  );

  return {
    ok: missingRequirements.length === 0,
    missingRequirements,
    notes: ["Mock Question Data is being used for the current availability check."],
  };
}

function buildLqSectionAvailability(
  section: LqSection,
  topicDistribution: Record<string, number>,
  difficultyDistribution: CountByDifficulty,
  counts: ReturnType<ExamGeneratorRepository["getAvailabilityCounts"]>,
): AvailabilityRequirement[] {
  const missingRequirements: AvailabilityRequirement[] = [];
  const topics = Object.keys(topicDistribution).filter(Boolean);

  for (const topic of topics) {
    const required = clampCount(topicDistribution[topic] ?? 0);
    if (!required) continue;
    const available = clampCount(counts.bySectionTopic[`${section}__${topic}`] ?? 0);
    if (available < required) {
      missingRequirements.push({
        key: `${section}__topic__${topic}`,
        label: `${section} + ${topic}`,
        required,
        available,
        missing: required - available,
      });
    }
  }

  for (const difficulty of EXAM_DIFFICULTIES) {
    const required = clampCount(difficultyDistribution[difficulty] ?? 0);
    if (!required) continue;
    const available = clampCount(counts.bySectionDifficulty[`${section}__${difficulty}`] ?? 0);
    if (available < required) {
      missingRequirements.push({
        key: `${section}__difficulty__${difficulty}`,
        label: `${section} + ${difficulty}`,
        required,
        available,
        missing: required - available,
      });
    }
  }

  const sectionPairCaps: Record<string, number> = {};
  for (const topic of topics) {
    for (const difficulty of EXAM_DIFFICULTIES) {
      sectionPairCaps[`${topic}__${difficulty}`] = clampCount(
        counts.bySectionTopicDifficulty[`${section}__${topic}__${difficulty}`] ?? 0,
      );
    }
  }

  missingRequirements.push(
    ...evaluateTopicDifficultyFeasibility({
      topics,
      topicDistribution,
      difficultyDistribution,
      capacities: sectionPairCaps,
    }).map((item) => ({
      ...item,
      key: `${section}__${item.key}`,
      label: `${section} · ${item.label}`,
    })),
  );

  return missingRequirements;
}

function buildLqAvailability(
  config: ExamGeneratorConfig,
  repository: ExamGeneratorRepository,
  topics: string[],
): AvailabilityCheckResult {
  const counts = repository.getAvailabilityCounts({ form: config.form, paperType: "LQ", topics });
  const missingRequirements: AvailabilityRequirement[] = [];

  for (const section of LQ_SECTIONS) {
    missingRequirements.push(
      ...buildLqSectionAvailability(
        section,
        config.lq[section].topicDistribution,
        config.lq[section].difficultyDistribution,
        counts,
      ),
    );
  }

  return {
    ok: missingRequirements.length === 0,
    missingRequirements,
    notes: ["Mock Question Data is being used for the current availability check."],
  };
}

export function validateExamGeneratorConfig(
  config: ExamGeneratorConfig,
  repository: ExamGeneratorRepository,
): ExamValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.form) errors.push("Select a form.");
  if (!config.paperType) errors.push("Select a paper type.");
  if (!config.paperType) {
    return { ok: false, errors, warnings, availability: null, canGenerate: false };
  }

  const topics = selectedTopicsForConfig(config, repository, config.paperType);
  if (config.topicMode === "specific" && topics.length === 0) {
    errors.push("Select at least one topic.");
  }

  if (config.questionSelectionMode === "overall") {
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      availability:
        errors.length === 0
          ? {
              ok: true,
              missingRequirements: [],
              notes: ["Auto-balanced mode will let the system handle detailed MC/LQ balancing later."],
            }
          : null,
      canGenerate: errors.length === 0,
    };
  }

  if (config.paperType === "MC") {
    const total = clampCount(config.mc.totalQuestions);
    if (total <= 0) errors.push("Total number of MC questions must be at least 1.");
    const topicTotal = sumCounts(config.mc.topicDistribution);
    const difficultyTotal = sumCounts(config.mc.difficultyDistribution);
    if (topicTotal !== total) {
      errors.push(`Total Topic Questions must = ${total}. Current total: ${topicTotal}.`);
    }
    if (difficultyTotal !== total) {
      errors.push(`Total Difficulty Questions must = ${total}. Current total: ${difficultyTotal}.`);
    }
  }

  if (config.paperType === "LQ") {
    for (const section of LQ_SECTIONS) {
      const sectionConfig = config.lq[section];
      const sectionCount = clampCount(sectionConfig.questionCount);
      const topicTotal = sumCounts(sectionConfig.topicDistribution);
      const difficultyTotal = sumCounts(sectionConfig.difficultyDistribution);
      if (topicTotal !== sectionCount) {
        errors.push(`${section} Total Topic Questions must = ${sectionCount}. Current total: ${topicTotal}.`);
      }
      if (difficultyTotal !== sectionCount) {
        errors.push(`${section} Total Difficulty Questions must = ${sectionCount}. Current total: ${difficultyTotal}.`);
      }
    }
  }

  const availability =
    errors.length > 0
      ? null
      : config.paperType === "MC"
        ? buildMcAvailability(config, repository, topics)
        : buildLqAvailability(config, repository, topics);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    availability,
    canGenerate: errors.length === 0 && Boolean(availability?.ok),
  };
}

export function getEffectiveTopicList(
  config: ExamGeneratorConfig,
  repository: ExamGeneratorRepository,
): string[] {
  if (!config.paperType) return [];
  return selectedTopicsForConfig(config, repository, config.paperType);
}
