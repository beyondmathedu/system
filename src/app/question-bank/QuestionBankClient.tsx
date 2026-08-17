"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppTopNav from "@/components/AppTopNav";
import RegionCropPreview from "@/components/question-bank/RegionCropPreview";
import PageWithRegionsOverlay from "@/components/question-bank/PageWithRegionsOverlay";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import type {
  AiDetectedQuestion,
  DraftQuestion,
  QuestionDifficulty,
  QuestionProcessingStatus,
  QuestionRow,
} from "@/lib/questionBankTypes";
import { newClientId, normalizeBBox, TEST_MODE_MAX_PAGES } from "@/lib/questionBankTypes";
import {
  cropPageDataUrl,
  renderFirstNPdfPages,
  type RenderedPdfPage,
} from "@/lib/renderPdfPages.client";

type SavedQuestion = QuestionRow & { image_url: string | null };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function draftFromAi(
  page: RenderedPdfPage,
  detected: AiDetectedQuestion,
  defaults: { subject: string; topic: string },
): DraftQuestion {
  const bbox = normalizeBBox(detected);
  const processingStatus: QuestionProcessingStatus = detected.needsReview
    ? "needs_review"
    : "ai_classified";
  return {
    clientId: newClientId(),
    pageNumber: page.pageNumber,
    questionLabel: detected.questionLabel || `${page.pageNumber}`,
    subject: defaults.subject,
    topic: detected.suggestedTopic || defaults.topic,
    subtopic: detected.suggestedSubtopic || "",
    sourceLabel: detected.sourceLabel,
    sourceYear: detected.sourceYear,
    examType: detected.examType,
    difficulty: detected.suggestedDifficulty,
    aiDifficulty: detected.suggestedDifficulty,
    aiDifficultyConfidence: detected.aiDifficultyConfidence,
    marks: detected.suggestedMarks,
    timeMinutes: null,
    bbox,
    previewDataUrl: "",
    processingStatus,
    approved: true,
  };
}

export default function QuestionBankClient({ navViewer }: { navViewer: AppTopNavViewer }) {
  const [fileName, setFileName] = useState("");
  const [totalPdfPages, setTotalPdfPages] = useState(0);
  const [pdfSourceId, setPdfSourceId] = useState<string | null>(null);
  const [pages, setPages] = useState<RenderedPdfPage[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [defaultSubject, setDefaultSubject] = useState("Mathematics");
  const [defaultTopic, setDefaultTopic] = useState("Coordinate Geometry");
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const [savedQuestions, setSavedQuestions] = useState<SavedQuestion[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const activePageData = useMemo(
    () => pages.find((p) => p.pageNumber === activePage) ?? null,
    [pages, activePage],
  );

  const pageDrafts = useMemo(
    () => drafts.filter((d) => d.pageNumber === activePage),
    [drafts, activePage],
  );

  const approvedCount = useMemo(() => drafts.filter((d) => d.approved).length, [drafts]);

  const loadSavedQuestions = useCallback(async () => {
    try {
      const res = await fetch("/api/question-bank/questions?limit=50", { credentials: "same-origin" });
      const body = (await res.json()) as { ok?: boolean; questions?: SavedQuestion[]; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to load");
      setSavedQuestions(body.questions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load saved questions");
    }
  }, []);

  useEffect(() => {
    void loadSavedQuestions();
  }, [loadSavedQuestions]);

  async function refreshDraftPreviews(nextDrafts: DraftQuestion[]) {
    const byPage = new Map<number, RenderedPdfPage>();
    for (const p of pages) byPage.set(p.pageNumber, p);

    const updated = await Promise.all(
      nextDrafts.map(async (draft) => {
        const page = byPage.get(draft.pageNumber);
        if (!page) return draft;
        try {
          const previewDataUrl = await cropPageDataUrl(
            page.dataUrl,
            page.width,
            page.height,
            draft.bbox,
          );
          return { ...draft, previewDataUrl };
        } catch {
          return draft;
        }
      }),
    );
    setDrafts(updated);
  }

  async function onPdfSelected(file: File | null) {
    setError("");
    setNotice("");
    setDrafts([]);
    setPdfSourceId(null);
    if (!file) return;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }

    setBusy(`Rendering first ${TEST_MODE_MAX_PAGES} page(s) for Test Mode…`);
    try {
      const { pages: rendered, totalPages } = await renderFirstNPdfPages(file, TEST_MODE_MAX_PAGES, 1.4);
      setPages(rendered);
      setTotalPdfPages(totalPages);
      setFileName(file.name);
      setActivePage(1);

      setBusy("Uploading PDF source…");
      const pdfDataUrl = await fileToDataUrl(file);
      const uploadRes = await fetch("/api/question-bank/upload-pdf", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          pdfDataUrl,
          pageCount: rendered.length,
          totalPageCount: totalPages,
        }),
      });
      const uploadBody = (await uploadRes.json()) as {
        ok?: boolean;
        source?: { id: string };
        error?: string;
      };
      if (!uploadRes.ok || !uploadBody.ok || !uploadBody.source?.id) {
        throw new Error(uploadBody.error ?? "PDF upload failed");
      }
      setPdfSourceId(uploadBody.source.id);
      setNotice(
        `Test Mode: loaded page 1–${rendered.length} of ${totalPages}. Run segmentation, inspect crops, then save.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load PDF");
      setPages([]);
    } finally {
      setBusy("");
    }
  }

  async function analyzePage(pageNumber: number) {
    const page = pages.find((p) => p.pageNumber === pageNumber);
    if (!page) return;

    setBusy(`AI segmenting page ${pageNumber}…`);
    setError("");
    try {
      const res = await fetch("/api/question-bank/test-segment", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageNumber,
          imageDataUrl: page.dataUrl,
          defaultSubject,
          defaultTopic,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        regions?: AiDetectedQuestion[];
        questions?: AiDetectedQuestion[];
        note?: string | null;
        usedAi?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Segmentation failed");

      const detected = body.regions ?? body.questions ?? [];
      const newDrafts = detected.map((q) =>
        draftFromAi(page, q, { subject: defaultSubject, topic: defaultTopic }),
      );
      const kept = drafts.filter((d) => d.pageNumber !== pageNumber);
      const merged = [...kept, ...newDrafts];
      setDrafts(merged);
      await refreshDraftPreviews(merged);
      if (body.note) setNotice(body.note);
      else {
        setNotice(
          `Page ${pageNumber}: detected ${newDrafts.length} region(s)${body.usedAi ? "" : " (placeholder)"}.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Segmentation failed");
    } finally {
      setBusy("");
    }
  }

  async function analyzeAllPages() {
    for (const page of pages) {
      await analyzePage(page.pageNumber);
    }
  }

  function updateDraft(clientId: string, patch: Partial<DraftQuestion>) {
    setDrafts((prev) => prev.map((d) => (d.clientId === clientId ? { ...d, ...patch } : d)));
  }

  async function saveApproved() {
    const approved = drafts.filter((d) => d.approved);
    if (!approved.length) {
      setError("No approved questions to save.");
      return;
    }
    let ready = approved;
    if (approved.some((d) => !d.previewDataUrl)) {
      await refreshDraftPreviews(drafts);
      ready = drafts.filter((d) => d.approved && d.previewDataUrl);
    }
    if (!ready.length) {
      setError("Could not prepare question images.");
      return;
    }

    setBusy("Saving questions to database…");
    setError("");
    try {
      const res = await fetch("/api/question-bank/save-questions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfSourceId,
          questions: ready.map((d) => ({
            pageNumber: d.pageNumber,
            questionLabel: d.questionLabel,
            subject: d.subject,
            topic: d.topic,
            subtopic: d.subtopic,
            sourceLabel: d.sourceLabel,
            sourceYear: d.sourceYear,
            examType: d.examType,
            difficulty: d.difficulty,
            aiDifficulty: d.aiDifficulty,
            aiDifficultyConfidence: d.aiDifficultyConfidence,
            marks: d.marks,
            timeMinutes: d.timeMinutes,
            bbox: d.bbox,
            imageDataUrl: d.previewDataUrl,
            processingStatus: d.processingStatus,
          })),
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        savedCount?: number;
        questionCodes?: string[];
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Save failed");

      setNotice(
        `Saved ${body.savedCount ?? ready.length} question(s) as ${body.questionCodes?.join(", ") ?? "pending review"}.`,
      );
      setDrafts((prev) => prev.filter((d) => !d.approved));
      await loadSavedQuestions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  function addManualBox() {
    if (!activePageData) return;
    const draft: DraftQuestion = {
      clientId: newClientId(),
      pageNumber: activePage,
      questionLabel: `${activePage}-${pageDrafts.length + 1}`,
      subject: defaultSubject,
      topic: defaultTopic,
      subtopic: "",
      sourceLabel: null,
      sourceYear: null,
      examType: null,
      difficulty: "needs_review",
      aiDifficulty: null,
      aiDifficultyConfidence: null,
      marks: null,
      timeMinutes: null,
      bbox: normalizeBBox({ top: 10, left: 5, width: 90, height: 20 }),
      previewDataUrl: "",
      processingStatus: "needs_review",
      approved: true,
    };
    const merged = [...drafts, draft];
    setDrafts(merged);
    void refreshDraftPreviews(merged);
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="question-bank" viewer={navViewer} />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">Question Bank — Test Mode</h1>
            <p className="mt-1 text-sm text-blue-100">
              Upload PDF → segment first {TEST_MODE_MAX_PAGES} pages → inspect crops → save for human review.
            </p>
          </div>

          <div className="space-y-6 p-6">
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {notice}
              </div>
            ) : null}
            {busy ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                {busy}
              </div>
            ) : null}

            <section className="rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-800">1. Upload PDF (Test Mode)</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="text-xs md:col-span-3">
                  <span className="font-semibold text-slate-600">PDF file</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => void onPdfSelected(e.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-sm"
                  />
                </label>
                <label className="text-xs">
                  <span className="font-semibold text-slate-600">Subject</span>
                  <input
                    value={defaultSubject}
                    onChange={(e) => setDefaultSubject(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs md:col-span-2">
                  <span className="font-semibold text-slate-600">Default topic</span>
                  <input
                    value={defaultTopic}
                    onChange={(e) => setDefaultTopic(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
              </div>
              {fileName ? (
                <p className="mt-2 text-xs text-slate-500">
                  {fileName} — showing pages 1–{pages.length}
                  {totalPdfPages > pages.length ? ` of ${totalPdfPages}` : ""}
                  {pdfSourceId ? ` · source ${pdfSourceId.slice(0, 8)}…` : ""}
                </p>
              ) : null}
            </section>

            {pages.length ? (
              <section className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-slate-800">2. Segment & inspect</h2>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void analyzePage(activePage)}
                      disabled={Boolean(busy)}
                      className="rounded-md bg-[#1d76c2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1663a8] disabled:opacity-50"
                    >
                      Segment this page
                    </button>
                    <button
                      type="button"
                      onClick={() => void analyzeAllPages()}
                      disabled={Boolean(busy)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Segment all test pages
                    </button>
                    <button
                      type="button"
                      onClick={addManualBox}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Add manual box
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveApproved()}
                      disabled={Boolean(busy) || approvedCount === 0}
                      className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Save {approvedCount} to DB
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {pages.map((page) => (
                    <button
                      key={page.pageNumber}
                      type="button"
                      onClick={() => setActivePage(page.pageNumber)}
                      className={`rounded-md px-3 py-1 text-sm font-semibold ${
                        activePage === page.pageNumber
                          ? "bg-[#1d76c2] text-white"
                          : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Page {page.pageNumber}
                    </button>
                  ))}
                </div>

                {activePageData ? (
                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-semibold text-slate-600">Page with detected regions</p>
                      <PageWithRegionsOverlay
                        pageDataUrl={activePageData.dataUrl}
                        regions={pageDrafts.map((draft) => ({
                          id: draft.clientId,
                          bbox: draft.bbox,
                          label: draft.questionLabel,
                        }))}
                        className="max-h-[70vh]"
                      />
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold text-slate-600">
                        Detected questions ({pageDrafts.length})
                      </p>
                      {!pageDrafts.length ? (
                        <p className="text-sm text-slate-600">
                          Run <strong>Segment this page</strong> to detect question regions.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {pageDrafts.map((draft) => (
                            <div
                              key={draft.clientId}
                              className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[140px_1fr]"
                            >
                              {draft.previewDataUrl ? (
                                <RegionCropPreview
                                  pageDataUrl={activePageData.dataUrl}
                                  pageWidth={activePageData.width}
                                  pageHeight={activePageData.height}
                                  bbox={draft.bbox}
                                  label={draft.questionLabel}
                                />
                              ) : (
                                <div className="flex h-24 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-500">
                                  Preview…
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                                <label className="text-xs">
                                  <span className="font-semibold text-slate-600">Label</span>
                                  <input
                                    value={draft.questionLabel}
                                    onChange={(e) =>
                                      updateDraft(draft.clientId, { questionLabel: e.target.value })
                                    }
                                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="text-xs md:col-span-2">
                                  <span className="font-semibold text-slate-600">Source label</span>
                                  <input
                                    value={draft.sourceLabel ?? ""}
                                    onChange={(e) =>
                                      updateDraft(draft.clientId, {
                                        sourceLabel: e.target.value || null,
                                      })
                                    }
                                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="text-xs">
                                  <span className="font-semibold text-slate-600">Topic</span>
                                  <input
                                    value={draft.topic}
                                    onChange={(e) => updateDraft(draft.clientId, { topic: e.target.value })}
                                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="text-xs">
                                  <span className="font-semibold text-slate-600">Difficulty</span>
                                  <select
                                    value={draft.difficulty}
                                    onChange={(e) =>
                                      updateDraft(draft.clientId, {
                                        difficulty: e.target.value as QuestionDifficulty,
                                      })
                                    }
                                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                                  >
                                    <option value="L1">L1</option>
                                    <option value="L2">L2</option>
                                    <option value="L3">L3</option>
                                    <option value="needs_review">Needs Review</option>
                                  </select>
                                </label>
                                <label className="text-xs">
                                  <span className="font-semibold text-slate-600">Marks</span>
                                  <input
                                    type="number"
                                    min={1}
                                    value={draft.marks ?? ""}
                                    onChange={(e) =>
                                      updateDraft(draft.clientId, {
                                        marks: e.target.value ? Math.max(1, Number(e.target.value)) : null,
                                      })
                                    }
                                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="text-xs">
                                  <span className="font-semibold text-slate-600">AI confidence</span>
                                  <input
                                    value={
                                      draft.aiDifficultyConfidence != null
                                        ? draft.aiDifficultyConfidence.toFixed(2)
                                        : "—"
                                    }
                                    readOnly
                                    className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="text-xs">
                                  <span className="font-semibold text-slate-600">Status</span>
                                  <input
                                    value={draft.processingStatus}
                                    readOnly
                                    className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="flex items-end gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={draft.approved}
                                    onChange={(e) =>
                                      updateDraft(draft.clientId, { approved: e.target.checked })
                                    }
                                    className="h-4 w-4 accent-[#1d76c2]"
                                  />
                                  <span className="font-semibold text-slate-700">Include in save</span>
                                </label>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void refreshDraftPreviews(
                                      drafts.map((d) =>
                                        d.clientId === draft.clientId ? { ...d, previewDataUrl: "" } : d,
                                      ),
                                    )
                                  }
                                  className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Refresh crop
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDrafts((prev) => prev.filter((d) => d.clientId !== draft.clientId))
                                  }
                                  className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-800">3. Pending review</h2>
              {!savedQuestions.length ? (
                <p className="mt-2 text-sm text-slate-600">No pending-review questions yet.</p>
              ) : (
                <div className="mt-3 overflow-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-bold text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Preview</th>
                        <th className="px-3 py-2">Code</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2">Topic</th>
                        <th className="px-3 py-2">Diff.</th>
                        <th className="px-3 py-2">AI conf.</th>
                        <th className="px-3 py-2">Marks</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {savedQuestions.map((q) => (
                        <tr key={q.id}>
                          <td className="px-3 py-2">
                            {q.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={q.image_url} alt={q.question_label} className="h-16 w-auto rounded border" />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 font-semibold">{q.question_code ?? "—"}</td>
                          <td className="px-3 py-2">{q.source_label || "—"}</td>
                          <td className="px-3 py-2">{q.topic || "—"}</td>
                          <td className="px-3 py-2">{q.difficulty ?? q.ai_difficulty ?? "—"}</td>
                          <td className="px-3 py-2">
                            {q.ai_difficulty_confidence != null
                              ? q.ai_difficulty_confidence.toFixed(2)
                              : "—"}
                          </td>
                          <td className="px-3 py-2">{q.marks ?? "—"}</td>
                          <td className="px-3 py-2">{q.processing_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="text-xs text-slate-500">
              Requires migration <code className="rounded bg-slate-100 px-1">20260817_question_bank.sql</code> and{" "}
              <code className="rounded bg-slate-100 px-1">OPENAI_API_KEY</code> for vision segmentation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
