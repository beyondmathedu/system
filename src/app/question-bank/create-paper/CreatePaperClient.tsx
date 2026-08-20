"use client";

import { useMemo, useState } from "react";
import AppTopNav from "@/components/AppTopNav";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { examGeneratorMockRepository } from "@/lib/examGeneratorMockRepository";
import {
  EXAM_DIFFICULTIES,
  EXAM_FORMS,
  LQ_SECTIONS,
  PAPER_TYPES,
  createInitialExamGeneratorConfig,
  type ExamDifficulty,
  type ExamGeneratorConfig,
  type ExamPaperType,
  type LqSection,
} from "@/lib/examGeneratorTypes";
import { getEffectiveTopicList, validateExamGeneratorConfig } from "@/lib/examGeneratorValidation";

function sectionTitle(section: LqSection): string {
  return `Section ${section}`;
}

function chipClass(active: boolean, disabled = false): string {
  if (disabled) return "cursor-not-allowed rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-400";
  return active
    ? "rounded-md bg-[#1d76c2] px-3 py-2 text-sm font-semibold text-white"
    : "rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50";
}

function sum(values: Record<string, number>): number {
  return Object.values(values).reduce((acc, value) => acc + (Number(value) || 0), 0);
}

export default function CreatePaperClient({ navViewer }: { navViewer: AppTopNavViewer }) {
  const [config, setConfig] = useState<ExamGeneratorConfig>(() => createInitialExamGeneratorConfig());
  const [topicSearch, setTopicSearch] = useState("");
  const [topicFormFilter, setTopicFormFilter] = useState<"all" | "F1" | "F2" | "F3" | "F4" | "F5" | "F6">("all");
  const [generateNotice, setGenerateNotice] = useState("");

  const supportedForms = useMemo(() => new Set(examGeneratorMockRepository.getSupportedForms()), []);
  const topicBrowseForm = useMemo(() => {
    if (topicFormFilter === "all") return undefined;
    return topicFormFilter;
  }, [topicFormFilter]);
  const availableTopics = useMemo(
    () => (config.paperType ? examGeneratorMockRepository.getTopics({ form: topicBrowseForm, paperType: config.paperType }) : []),
    [config.paperType, topicBrowseForm],
  );
  const filteredTopics = useMemo(() => {
    const q = topicSearch.trim().toLowerCase();
    if (!q) return availableTopics;
    return availableTopics.filter((item) => item.topic.toLowerCase().includes(q));
  }, [availableTopics, topicSearch]);
  const effectiveTopics = useMemo(() => getEffectiveTopicList(config, examGeneratorMockRepository), [config]);
  const validation = useMemo(() => validateExamGeneratorConfig(config, examGeneratorMockRepository), [config]);

  function updateConfig(patch: Partial<ExamGeneratorConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }));
    setGenerateNotice("");
  }

  function setPaperType(paperType: ExamPaperType) {
    updateConfig({
      paperType,
      topicMode: "specific",
      selectedTopics: [],
      selectedQuestionIds: [],
      questionSelectionMode: "overall",
      mc: { ...config.mc, topicDistribution: {} },
      lq: {
        A: { ...config.lq.A, topicDistribution: {} },
        B1: { ...config.lq.B1, topicDistribution: {} },
        B2: { ...config.lq.B2, topicDistribution: {} },
      },
    });
  }

  function toggleTopic(topic: string) {
    setConfig((prev) => {
      const exists = prev.selectedTopics.includes(topic);
      return {
        ...prev,
        selectedTopics: exists ? prev.selectedTopics.filter((item) => item !== topic) : [...prev.selectedTopics, topic],
      };
    });
  }

  function selectAllTopics(topics: string[]) {
    updateConfig({ topicMode: "specific", selectedTopics: topics });
  }

  function updateMcTopic(topic: string, value: number) {
    setConfig((prev) => ({
      ...prev,
      mc: {
        ...prev.mc,
        topicDistribution: { ...prev.mc.topicDistribution, [topic]: Math.max(0, Math.floor(value || 0)) },
      },
    }));
  }

  function updateMcDifficulty(difficulty: ExamDifficulty, value: number) {
    setConfig((prev) => ({
      ...prev,
      mc: {
        ...prev.mc,
        difficultyDistribution: {
          ...prev.mc.difficultyDistribution,
          [difficulty]: Math.max(0, Math.floor(value || 0)),
        },
      },
    }));
  }

  function updateLqSectionCount(section: LqSection, value: number) {
    setConfig((prev) => ({
      ...prev,
      lq: {
        ...prev.lq,
        [section]: { ...prev.lq[section], questionCount: Math.max(0, Math.floor(value || 0)) },
      },
    }));
  }

  function updateLqTopic(section: LqSection, topic: string, value: number) {
    setConfig((prev) => ({
      ...prev,
      lq: {
        ...prev.lq,
        [section]: {
          ...prev.lq[section],
          topicDistribution: {
            ...prev.lq[section].topicDistribution,
            [topic]: Math.max(0, Math.floor(value || 0)),
          },
        },
      },
    }));
  }

  function updateLqDifficulty(section: LqSection, difficulty: ExamDifficulty, value: number) {
    setConfig((prev) => ({
      ...prev,
      lq: {
        ...prev.lq,
        [section]: {
          ...prev.lq[section],
          difficultyDistribution: {
            ...prev.lq[section].difficultyDistribution,
            [difficulty]: Math.max(0, Math.floor(value || 0)),
          },
        },
      },
    }));
  }

  function onGenerate() {
    if (!validation.canGenerate) return;
    setGenerateNotice(
      "Configuration is valid. MVP generation output is intentionally not implemented yet; this screen currently proves the UI and deterministic validation flow.",
    );
  }

  const lqSelectedCount = useMemo(
    () => LQ_SECTIONS.reduce((acc, section) => acc + (config.lq[section].questionCount || 0), 0),
    [config.lq],
  );
  const showsPaperSettings = Boolean(config.paperType) && config.questionSelectionMode === "select_questions";
  const generateStepNumber = showsPaperSettings ? 6 : 5;

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="question-bank" viewer={navViewer} />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">Create Exam Paper</h1>
            <p className="mt-1 text-sm text-blue-100">
              Configure paper requirements first. AI classification and real question-bank integration can plug in later.
            </p>
          </div>

          <div className="space-y-6 p-6">
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              Using <strong>Mock Question Data</strong> for topics, question search, and availability checks in this MVP.
            </div>

            <section className="rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-800">1. Form</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAM_FORMS.map((form) => {
                  const enabled = supportedForms.has(form);
                  return (
                    <button
                      key={form}
                      type="button"
                      disabled={!enabled}
                      onClick={() => enabled && updateConfig({ form })}
                      className={chipClass(config.form === form, !enabled)}
                    >
                      Form {form.slice(1)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">Forms 1-5 are shown but disabled because the current mock question bank only contains Form 6 data.</p>
            </section>

            <section className="rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-800">2. Paper Type</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {PAPER_TYPES.map((paperType) => (
                  <button
                    key={paperType}
                    type="button"
                    onClick={() => setPaperType(paperType)}
                    className={chipClass(config.paperType === paperType)}
                  >
                    {paperType}
                  </button>
                ))}
              </div>
            </section>

            {config.paperType ? (
              <section className="rounded-xl border border-slate-200 p-4">
                <h2 className="text-sm font-bold text-slate-800">3. Topic</h2>
                <div className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-600">F.x select</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setTopicFormFilter("all")}
                        className={chipClass(topicFormFilter === "all")}
                      >
                        All forms
                      </button>
                      {EXAM_FORMS.map((form) => (
                        <button
                          key={form}
                          type="button"
                          onClick={() => setTopicFormFilter(form)}
                          className={chipClass(topicFormFilter === form)}
                        >
                          {form}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="block text-xs">
                    <span className="font-semibold text-slate-600">Search topic</span>
                    <input
                      value={topicSearch}
                      onChange={(e) => setTopicSearch(e.target.value)}
                      placeholder="Search topics..."
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        selectAllTopics(
                          examGeneratorMockRepository.getTopics({ paperType: config.paperType! }).map((item) => item.topic),
                        )
                      }
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Select All Forms
                    </button>
                    <button
                      type="button"
                      onClick={() => selectAllTopics(filteredTopics.map((item) => item.topic))}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Select All ({topicBrowseForm ?? "All"})
                    </button>
                    <button
                      type="button"
                      onClick={() => updateConfig({ selectedTopics: [] })}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Clear Selection
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {filteredTopics.map((item) => {
                      const checked = config.selectedTopics.includes(item.topic);
                      return (
                        <label key={item.topic} className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTopic(item.topic)}
                            className="h-4 w-4 accent-[#1d76c2]"
                          />
                          <span>{item.topic}</span>
                        </label>
                      );
                    })}
                  </div>
                  {!filteredTopics.length ? (
                    <p className="text-xs text-slate-500">No topics found for this paper type and F.x filter.</p>
                  ) : null}
                  <p className="text-xs text-slate-500">
                    Selected topics: {config.selectedTopics.length ? config.selectedTopics.join(", ") : "none"}
                  </p>
                </div>
              </section>
            ) : null}

            {config.paperType ? (
              <section className="rounded-xl border border-slate-200 p-4">
                <h2 className="text-sm font-bold text-slate-800">4. Question Selection</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => updateConfig({ questionSelectionMode: "overall", selectedQuestionIds: [] })}
                    className={chipClass(config.questionSelectionMode === "overall")}
                  >
                    Overall (Auto-balanced)
                  </button>
                  <button
                    type="button"
                    onClick={() => updateConfig({ questionSelectionMode: "select_questions" })}
                    className={chipClass(config.questionSelectionMode === "select_questions")}
                  >
                    Select Questions
                  </button>
                </div>

                {config.questionSelectionMode === "select_questions" ? (
                  <p className="mt-3 text-sm text-slate-600">
                    Set the topic, difficulty, section, and count requirements yourself in the next step.
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">
                    The system will auto-select questions as evenly as possible according to your topic, difficulty,
                    and section requirements.
                  </p>
                )}
              </section>
            ) : null}

            {config.paperType === "MC" && config.questionSelectionMode === "select_questions" ? (
              <section className="rounded-xl border border-slate-200 p-4">
                <h2 className="text-sm font-bold text-slate-800">5. MC Paper Settings</h2>
                <label className="mt-3 block text-xs">
                  <span className="font-semibold text-slate-600">Number of Questions</span>
                  <input
                    type="number"
                    min={1}
                    value={config.mc.totalQuestions}
                    onChange={(e) =>
                      updateConfig({
                        mc: { ...config.mc, totalQuestions: Math.max(0, Math.floor(Number(e.target.value) || 0)) },
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm md:max-w-[180px]"
                  />
                </label>

                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-800">Topic Distribution</h3>
                      <span className="text-xs text-slate-500">
                        Total Topic Questions: {sum(config.mc.topicDistribution)} / {config.mc.totalQuestions}
                      </span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {effectiveTopics.map((topic) => (
                        <label key={topic} className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2 text-sm">
                          <span>{topic}</span>
                          <input
                            type="number"
                            min={0}
                            value={config.mc.topicDistribution[topic] ?? 0}
                            onChange={(e) => updateMcTopic(topic, Number(e.target.value))}
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                          />
                        </label>
                      ))}
                    </div>
                    {sum(config.mc.topicDistribution) !== config.mc.totalQuestions ? (
                      <p className="mt-2 text-xs font-semibold text-red-700">
                        Total Topic Questions must = {config.mc.totalQuestions}.
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-800">Difficulty Distribution</h3>
                      <span className="text-xs text-slate-500">
                        Total Difficulty Questions: {sum(config.mc.difficultyDistribution)} / {config.mc.totalQuestions}
                      </span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {EXAM_DIFFICULTIES.map((difficulty) => (
                        <label key={difficulty} className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2 text-sm">
                          <span>Level {difficulty.slice(1)}</span>
                          <input
                            type="number"
                            min={0}
                            value={config.mc.difficultyDistribution[difficulty]}
                            onChange={(e) => updateMcDifficulty(difficulty, Number(e.target.value))}
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                          />
                        </label>
                      ))}
                    </div>
                    {sum(config.mc.difficultyDistribution) !== config.mc.totalQuestions ? (
                      <p className="mt-2 text-xs font-semibold text-red-700">
                        Total Difficulty Questions must = {config.mc.totalQuestions}.
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}

            {config.paperType === "LQ" && config.questionSelectionMode === "select_questions" ? (
              <section className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-slate-800">5. LQ Section Configuration</h2>
                  <span className="text-xs text-slate-500">Total LQ questions: {lqSelectedCount}</span>
                </div>
                <div className="mt-4 space-y-5">
                  {LQ_SECTIONS.map((section) => (
                    <div key={section} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-800">{sectionTitle(section)}</h3>
                        <label className="text-xs">
                          <span className="font-semibold text-slate-600">Question count</span>
                          <input
                            type="number"
                            min={0}
                            value={config.lq[section].questionCount}
                            onChange={(e) => updateLqSectionCount(section, Number(e.target.value))}
                            className="ml-2 w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                          />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-5 xl:grid-cols-2">
                        <div>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-800">Topic Distribution</p>
                            <span className="text-xs text-slate-500">
                              {sum(config.lq[section].topicDistribution)} / {config.lq[section].questionCount}
                            </span>
                          </div>
                          <div className="mt-2 space-y-2">
                            {effectiveTopics.map((topic) => (
                              <label key={`${section}-${topic}`} className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2 text-sm">
                                <span>{topic}</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={config.lq[section].topicDistribution[topic] ?? 0}
                                  onChange={(e) => updateLqTopic(section, topic, Number(e.target.value))}
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                                />
                              </label>
                            ))}
                          </div>
                          {sum(config.lq[section].topicDistribution) !== config.lq[section].questionCount ? (
                            <p className="mt-2 text-xs font-semibold text-red-700">
                              Total Topic Questions must = {config.lq[section].questionCount}.
                            </p>
                          ) : null}
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-800">Difficulty Distribution</p>
                            <span className="text-xs text-slate-500">
                              {sum(config.lq[section].difficultyDistribution)} / {config.lq[section].questionCount}
                            </span>
                          </div>
                          <div className="mt-2 space-y-2">
                            {EXAM_DIFFICULTIES.map((difficulty) => (
                              <label key={`${section}-${difficulty}`} className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2 text-sm">
                                <span>Level {difficulty.slice(1)}</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={config.lq[section].difficultyDistribution[difficulty]}
                                  onChange={(e) => updateLqDifficulty(section, difficulty, Number(e.target.value))}
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                                />
                              </label>
                            ))}
                          </div>
                          {sum(config.lq[section].difficultyDistribution) !== config.lq[section].questionCount ? (
                            <p className="mt-2 text-xs font-semibold text-red-700">
                              Total Difficulty Questions must = {config.lq[section].questionCount}.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {config.paperType ? (
              <section className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-800">{generateStepNumber}. Generate Paper</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Generation stays disabled until the configuration is valid and enough questions exist.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onGenerate}
                    disabled={!validation.canGenerate}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Generate Paper
                  </button>
                </div>

                {validation.errors.length === 0 && validation.availability?.ok ? (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    <p className="font-semibold">All requirements satisfied.</p>
                    {validation.availability.notes.map((note) => (
                      <p key={note} className="mt-1 text-xs text-emerald-700">
                        {note}
                      </p>
                    ))}
                  </div>
                ) : null}

                {validation.errors.length === 0 && validation.availability && !validation.availability.ok ? (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <p className="font-semibold">Not enough questions</p>
                    <div className="mt-3 space-y-2">
                      {validation.availability.missingRequirements.map((item) => (
                        <div key={item.key} className="rounded border border-red-200 bg-white px-3 py-2">
                          <p className="font-semibold">{item.label}</p>
                          <p className="mt-1 text-xs">
                            Required: {item.required} · Available: {item.available} · Missing: {item.missing}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {generateNotice ? (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    {generateNotice}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">MVP Notes</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    You can configure the paper here now. Real question-bank matching and final paper export will be added later.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
