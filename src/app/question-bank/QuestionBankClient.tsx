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
  QuestionBankShelfStatus,
  QuestionDifficulty,
  QuestionPdfSourceRow,
  QuestionProcessingStatus,
  QuestionRow,
} from "@/lib/questionBankTypes";
import { newClientId, normalizeBBox } from "@/lib/questionBankTypes";
import { cropPageDataUrl, renderAllPdfPages, type RenderedPdfPage } from "@/lib/renderPdfPages.client";
import { detectQuestionsBySetHeaders } from "@/lib/segmentPdfPageBySet.client";
import { isLikelyFullPagePlaceholder } from "@/lib/segmentPdfPageBySet";

type SavedQuestion = QuestionRow & { image_url: string | null };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function formatDateTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function sourceStatusLabel(status: QuestionBankShelfStatus): string {
  switch (status) {
    case "uploaded":
      return "Uploaded";
    case "needs_segmentation":
      return "Needs segmentation";
    case "segmented":
      return "Segmented";
    case "needs_review":
      return "Needs review";
    case "ready":
      return "Ready";
    default:
      return status;
  }
}

function sourceStatusClass(status: QuestionBankShelfStatus): string {
  switch (status) {
    case "ready":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "needs_review":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "segmented":
      return "bg-sky-50 text-sky-700 border-sky-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function draftFromAi(
  sourceId: string | null,
  page: RenderedPdfPage,
  detected: AiDetectedQuestion,
  defaults: { subject: string; topic: string },
): DraftQuestion {
  const bbox = normalizeBBox(detected);
  const processingStatus: QuestionProcessingStatus = detected.needsReview ? "needs_review" : "ai_classified";
  return {
    clientId: newClientId(),
    pdfSourceId: sourceId,
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
  const [sources, setSources] = useState<QuestionPdfSourceRow[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [totalPdfPages, setTotalPdfPages] = useState(0);
  const [pages, setPages] = useState<RenderedPdfPage[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [defaultSubject, setDefaultSubject] = useState("Mathematics");
  const [defaultTopic, setDefaultTopic] = useState("Coordinate Geometry");
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const [savedQuestions, setSavedQuestions] = useState<SavedQuestion[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) ?? null,
    [sources, activeSourceId],
  );
  const activePageData = useMemo(
    () => pages.find((p) => p.pageNumber === activePage) ?? null,
    [pages, activePage],
  );
  const sourceDrafts = useMemo(
    () => drafts.filter((d) => d.pdfSourceId === activeSourceId),
    [drafts, activeSourceId],
  );
  const pageDrafts = useMemo(
    () => sourceDrafts.filter((d) => d.pageNumber === activePage),
    [sourceDrafts, activePage],
  );
  const approvedCount = useMemo(() => sourceDrafts.filter((d) => d.approved).length, [sourceDrafts]);

  const loadSources = useCallback(async () => {
    const res = await fetch("/api/question-bank/sources?limit=100", { credentials: "same-origin" });
    const body = (await res.json()) as { ok?: boolean; sources?: QuestionPdfSourceRow[]; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to load paper shelf");
    const nextSources = body.sources ?? [];
    setSources(nextSources);
    if (!activeSourceId && nextSources[0]?.id) {
      setActiveSourceId(nextSources[0].id);
    }
    return nextSources;
  }, [activeSourceId]);

  const loadSavedQuestions = useCallback(async (sourceId?: string | null) => {
    const params = new URLSearchParams({ limit: "100" });
    if (sourceId) params.set("pdfSourceId", sourceId);
    const res = await fetch(`/api/question-bank/questions?${params.toString()}`, {
      credentials: "same-origin",
    });
    const body = (await res.json()) as { ok?: boolean; questions?: SavedQuestion[]; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to load saved questions");
    setSavedQuestions(body.questions ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadSources();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load paper shelf");
      }
    })();
  }, [loadSources]);

  useEffect(() => {
    void (async () => {
      try {
        await loadSavedQuestions(activeSourceId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load saved questions");
      }
    })();
  }, [activeSourceId, loadSavedQuestions]);

  async function refreshDraftPreviews(nextDrafts: DraftQuestion[]) {
    const byPage = new Map<number, RenderedPdfPage>();
    for (const page of pages) byPage.set(page.pageNumber, page);

    const updated = await Promise.all(
      nextDrafts.map(async (draft) => {
        if (draft.pdfSourceId !== activeSourceId) return draft;
        const page = byPage.get(draft.pageNumber);
        if (!page) return draft;
        try {
          const previewDataUrl = await cropPageDataUrl(page.dataUrl, page.width, page.height, draft.bbox);
          return { ...draft, previewDataUrl };
        } catch {
          return draft;
        }
      }),
    );
    setDrafts(updated);
  }

  async function openSource(source: QuestionPdfSourceRow, fileOverride?: File) {
    setBusy(`Opening ${source.file_name}…`);
    setError("");
    setNotice("");
    try {
      let file = fileOverride ?? pdfFile;
      if (!file || activeSourceId !== source.id) {
        if (fileOverride) {
          file = fileOverride;
        } else if (source.signed_pdf_url) {
          const response = await fetch(source.signed_pdf_url);
          if (!response.ok) throw new Error(`Failed to download ${source.file_name}`);
          const blob = await response.blob();
          file = new File([blob], source.file_name, { type: "application/pdf" });
        } else {
          throw new Error("This paper source does not have a signed PDF URL.");
        }
      }

      const rendered = await renderAllPdfPages(file!, 1.4);
      setPdfFile(file!);
      setPages(rendered);
      setTotalPdfPages(rendered.length);
      setActiveSourceId(source.id);
      setFileName(source.file_name);
      setActivePage(1);
      setNotice(
        `${source.file_name}: loaded ${rendered.length} page(s). Review page-by-page, segment into drafts, then save reviewed questions.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open paper");
    } finally {
      setBusy("");
    }
  }

  async function onPdfSelected(file: File | null) {
    setError("");
    setNotice("");
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }

    setBusy("Uploading paper source…");
    try {
      const pdfDataUrl = await fileToDataUrl(file);
      const rendered = await renderAllPdfPages(file, 1.4);
      const uploadRes = await fetch("/api/question-bank/upload-pdf", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          pdfDataUrl,
          pageCount: rendered.length,
          totalPageCount: rendered.length,
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

      const nextSources = await loadSources();
      const nextSource =
        nextSources.find((source) => source.id === uploadBody.source?.id) ??
        ({
          id: uploadBody.source.id,
          file_name: file.name,
          storage_path: "",
          page_count: rendered.length,
          status: "uploaded",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          signed_pdf_url: null,
          saved_question_count: 0,
          needs_review_count: 0,
          ready_question_count: 0,
          shelf_status: "needs_segmentation",
        } as QuestionPdfSourceRow);
      await openSource(nextSource, file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload paper");
    } finally {
      setBusy("");
    }
  }

  async function analyzePage(pageNumber: number) {
    const page = pages.find((p) => p.pageNumber === pageNumber);
    if (!page) return;

    setBusy(`Segmenting page ${pageNumber}…`);
    setError("");
    try {
      let detected: AiDetectedQuestion[] = [];
      let note: string | null = null;
      let usedSetSplit = false;

      if (pdfFile) {
        const setRegions = await detectQuestionsBySetHeaders(pdfFile, pageNumber, defaultTopic);
        if (setRegions.length > 0) {
          detected = setRegions;
          usedSetSplit = true;
          note = `Page ${pageNumber}: split into ${setRegions.length} question draft(s) by Set headers.`;
        }
      }

      if (!detected.length) {
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

        detected = body.regions ?? body.questions ?? [];
        note = body.note ?? null;

        if (pdfFile && (isLikelyFullPagePlaceholder(detected, pageNumber) || detected.length <= 1)) {
          const setRegions = await detectQuestionsBySetHeaders(pdfFile, pageNumber, defaultTopic);
          if (setRegions.length > 1) {
            detected = setRegions;
            usedSetSplit = true;
            note = `Page ${pageNumber}: AI returned one region, so the page was re-split into ${setRegions.length} drafts by Set headers.`;
          }
        }
      }

      const newDrafts = detected.map((question) =>
        draftFromAi(activeSourceId, page, question, { subject: defaultSubject, topic: defaultTopic }),
      );
      const kept = drafts.filter((draft) => !(draft.pdfSourceId === activeSourceId && draft.pageNumber === pageNumber));
      const merged = [...kept, ...newDrafts];
      setDrafts(merged);
      await refreshDraftPreviews(merged);
      setNotice(
        note ??
          `Page ${pageNumber}: created ${newDrafts.length} question draft(s)${usedSetSplit ? " using Set headers" : ""}.`,
      );
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
    setDrafts((prev) => prev.map((draft) => (draft.clientId === clientId ? { ...draft, ...patch } : draft)));
  }

  async function saveApproved() {
    const approved = sourceDrafts.filter((draft) => draft.approved);
    if (!approved.length || !activeSourceId) {
      setError("No approved drafts to save for this paper.");
      return;
    }

    let ready = approved;
    if (approved.some((draft) => !draft.previewDataUrl)) {
      await refreshDraftPreviews(drafts);
      ready = drafts.filter((draft) => draft.pdfSourceId === activeSourceId && draft.approved && draft.previewDataUrl);
    }
    if (!ready.length) {
      setError("Could not prepare question images.");
      return;
    }

    setBusy("Saving reviewed questions to the bank…");
    setError("");
    try {
      const res = await fetch("/api/question-bank/save-questions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfSourceId: activeSourceId,
          questions: ready.map((draft) => ({
            pageNumber: draft.pageNumber,
            questionLabel: draft.questionLabel,
            subject: draft.subject,
            topic: draft.topic,
            subtopic: draft.subtopic,
            sourceLabel: draft.sourceLabel,
            sourceYear: draft.sourceYear,
            examType: draft.examType,
            difficulty: draft.difficulty,
            aiDifficulty: draft.aiDifficulty,
            aiDifficultyConfidence: draft.aiDifficultyConfidence,
            marks: draft.marks,
            timeMinutes: draft.timeMinutes,
            bbox: draft.bbox,
            imageDataUrl: draft.previewDataUrl,
            processingStatus: draft.processingStatus,
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

      setDrafts((prev) => prev.filter((draft) => !(draft.pdfSourceId === activeSourceId && draft.approved)));
      await Promise.all([loadSavedQuestions(activeSourceId), loadSources()]);
      setNotice(
        `Saved ${body.savedCount ?? ready.length} reviewed question(s) for ${activeSource?.file_name ?? "this paper"} as ${body.questionCodes?.join(", ") ?? "pending review"}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="question-bank" viewer={navViewer} />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">Question Bank Shelf</h1>
            <p className="mt-1 text-sm text-blue-100">
              Start paper-first: upload papers, browse pages, create segmentation drafts, then save reviewed questions into the bank.
            </p>
          </div>

          <div className="space-y-6 p-6">
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
            ) : null}
            {notice ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {notice}
              </div>
            ) : null}
            {busy ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">{busy}</div>
            ) : null}

            <section className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">1. Add Paper To Shelf</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload whole PDFs first. Paper generation comes later after enough reviewed questions exist.
                  </p>
                </div>
              </div>
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
            </section>

            <section className="rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-800">2. Paper Shelf Workspace</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
                <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">Paper Sources</h3>
                    <span className="text-xs text-slate-500">{sources.length} paper(s)</span>
                  </div>
                  {!sources.length ? (
                    <p className="mt-3 text-sm text-slate-600">No uploaded papers yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {sources.map((source) => (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => void openSource(source)}
                          className={`w-full rounded-xl border p-3 text-left ${
                            activeSourceId === source.id
                              ? "border-[#1d76c2] bg-white shadow-sm"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="line-clamp-2 text-sm font-semibold text-slate-800">{source.file_name}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {source.page_count} pages · added {formatDateTime(source.created_at)}
                              </p>
                            </div>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sourceStatusClass(source.shelf_status)}`}
                            >
                              {sourceStatusLabel(source.shelf_status)}
                            </span>
                          </div>
                          <div className="mt-2 flex gap-3 text-xs text-slate-500">
                            <span>{source.saved_question_count} saved</span>
                            <span>{source.needs_review_count} review</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </aside>

                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-800">
                          {activeSource ? activeSource.file_name : "Select a paper"}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {activeSource
                            ? `${totalPdfPages || activeSource.page_count} page(s) · status ${sourceStatusLabel(activeSource.shelf_status)}`
                            : "Choose a paper from the shelf to browse pages and create drafts."}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void analyzeAllPages()}
                          disabled={Boolean(busy) || !pages.length}
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Segment all pages
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveApproved()}
                          disabled={Boolean(busy) || approvedCount === 0 || !activeSourceId}
                          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Save {approvedCount} reviewed question(s)
                        </button>
                      </div>
                    </div>

                    {fileName ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Viewing {fileName}
                        {activeSourceId ? ` · source ${activeSourceId.slice(0, 8)}…` : ""}
                      </p>
                    ) : null}

                    {!pages.length ? (
                      <p className="mt-4 text-sm text-slate-600">Open a paper from the shelf to see its pages.</p>
                    ) : (
                      <>
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
                              <p className="mb-2 text-xs font-semibold text-slate-600">Page preview</p>
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
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-slate-600">
                                  Segmentation drafts for page {activePage} ({pageDrafts.length})
                                </p>
                                <button
                                  type="button"
                                  onClick={() => void analyzePage(activePage)}
                                  disabled={Boolean(busy)}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  Re-segment this page
                                </button>
                              </div>
                              {!pageDrafts.length ? (
                                <p className="text-sm text-slate-600">
                                  No drafts yet for this page. Run segmentation to create draft question crops before saving anything to the bank.
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
                                            onChange={(e) => updateDraft(draft.clientId, { questionLabel: e.target.value })}
                                            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                                          />
                                        </label>
                                        <label className="text-xs md:col-span-2">
                                          <span className="font-semibold text-slate-600">Source label</span>
                                          <input
                                            value={draft.sourceLabel ?? ""}
                                            onChange={(e) =>
                                              updateDraft(draft.clientId, { sourceLabel: e.target.value || null })
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
                                          <span className="font-semibold text-slate-600">Draft status</span>
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
                                            onChange={(e) => updateDraft(draft.clientId, { approved: e.target.checked })}
                                            className="h-4 w-4 accent-[#1d76c2]"
                                          />
                                          <span className="font-semibold text-slate-700">Include in save</span>
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void refreshDraftPreviews(
                                              drafts.map((item) =>
                                                item.clientId === draft.clientId ? { ...item, previewDataUrl: "" } : item,
                                              ),
                                            )
                                          }
                                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                        >
                                          Refresh crop
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setDrafts((prev) => prev.filter((item) => item.clientId !== draft.clientId))}
                                          className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                                        >
                                          Remove draft
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">3. Saved Question Bank Entries</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    These are finalized question rows already saved from the current paper. Automatic paper generation is intentionally deferred until this library grows.
                  </p>
                </div>
                {activeSource ? (
                  <span className="text-xs text-slate-500">{activeSource.file_name}</span>
                ) : null}
              </div>

              {!savedQuestions.length ? (
                <p className="mt-3 text-sm text-slate-600">No saved questions for this paper yet.</p>
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
                      {savedQuestions.map((question) => (
                        <tr key={question.id}>
                          <td className="px-3 py-2">
                            {question.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={question.image_url}
                                alt={question.question_label}
                                className="h-16 w-auto rounded border"
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 font-semibold">{question.question_code ?? "—"}</td>
                          <td className="px-3 py-2">{question.source_label || "—"}</td>
                          <td className="px-3 py-2">{question.topic || "—"}</td>
                          <td className="px-3 py-2">{question.difficulty ?? question.ai_difficulty ?? "—"}</td>
                          <td className="px-3 py-2">
                            {question.ai_difficulty_confidence != null
                              ? question.ai_difficulty_confidence.toFixed(2)
                              : "—"}
                          </td>
                          <td className="px-3 py-2">{question.marks ?? "—"}</td>
                          <td className="px-3 py-2">{question.processing_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="text-xs text-slate-500">
              First-time setup: run{" "}
              <code className="rounded bg-slate-100 px-1">supabase/migrations/20260817_question_bank.sql</code>{" "}
              in Supabase SQL Editor, plus the patch migrations added in this branch if your schema is older. Set{" "}
              <code className="rounded bg-slate-100 px-1">OPENAI_API_KEY</code> for AI segmentation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
