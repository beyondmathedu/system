"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { TUTOR_SHARED_IPAD_EMAIL } from "@/lib/tutorConstants";
import { defaultDailyTimetablePath } from "@/lib/tutorRoomAccess";
import { supabase } from "@/lib/supabase";
import {
  loadLessonScheduleRecords,
  loadLessonYearState,
  loadStudentInactivePeriods,
  loadStudentVisibilityMode,
  saveStudentVisibilityMode,
  saveLessonYearMetrics,
  updateStudentInactivePeriodEndDate,
} from "@/lib/studentLessonStorage";
import { getLessonUntickedMetrics, type Lesson2026State } from "@/lib/lesson2026Summary";
import { availableLessonYears, defaultLessonYear } from "@/lib/lessonCalendar";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import AppTopNav from "@/components/AppTopNav";
import ClientOnlyAfterMount from "@/components/ClientOnlyAfterMount";
import ExamDateField from "./ExamDateField";
import type { LessonScheduleRecord } from "./LessonScheduleGrid";
import { isLegacyBmStudentId, normalizeStudentId } from "@/lib/studentId";
import { formatGradeDisplay } from "@/lib/grade";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";

const LessonScheduleGrid = dynamic(() => import("./LessonScheduleGrid"), {
  ssr: false,
  loading: () => <div className="h-48 animate-pulse rounded-xl bg-slate-100" aria-hidden />,
});

function dayAfterIso(iso: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function dedupeInactivePeriodRows<
  T extends { id?: number; start_date: string; end_date: string | null; note: string },
>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = `${row.start_date}|${row.end_date ?? ""}|${row.note ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function toLesson2026State(state: Awaited<ReturnType<typeof loadLessonYearState>>): Lesson2026State {
  return {
    attendance: state.attendance as Record<string, boolean>,
    hiddenDates: state.hiddenDates as Record<string, boolean>,
    overrides: state.overrides as Lesson2026State["overrides"],
    rescheduleEntries: state.rescheduleEntries as Lesson2026State["rescheduleEntries"],
    extraEntries: state.extraEntries as Lesson2026State["extraEntries"],
  };
}

type StudentSummary = {
  id: string;
  nameZh: string;
  nameEn: string;
  nicknameEn: string;
  grade: string;
  school: string;
  textbookPublisher: string;
};

export default function StudentLessonsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const rawId = String(params?.id || "");
  const studentId = normalizeStudentId(rawId);
  const [studentSummary, setStudentSummary] = useState<StudentSummary>({
    id: studentId,
    nameZh: "",
    nameEn: "",
    nicknameEn: "",
    grade: "",
    school: "",
    textbookPublisher: "",
  });
  const [studentLoaded, setStudentLoaded] = useState(false);
  const [studentNotFound, setStudentNotFound] = useState(false);
  const [upcomingUntickedCount, setUpcomingUntickedCount] = useState(0);
  const [currentMonthUntickedCount, setCurrentMonthUntickedCount] = useState(0);
  const [visibilityMode, setVisibilityMode] = useState<"active" | "inactive">("active");
  const [visibilityEffectiveDate, setVisibilityEffectiveDate] = useState("");
  const [visibilityReactivateDate, setVisibilityReactivateDate] = useState("");
  const [visibilityNote, setVisibilityNote] = useState("");
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [inactiveHistoryOpen, setInactiveHistoryOpen] = useState(false);
  const [inactivePeriods, setInactivePeriods] = useState<
    Array<{ id?: number; start_date: string; end_date: string | null; note: string }>
  >([]);
  /** Draft Expected return dates keyed by period id (stringified). */
  const [returnDraftByPeriodId, setReturnDraftByPeriodId] = useState<Record<string, string>>({});
  const [returnSavingPeriodId, setReturnSavingPeriodId] = useState<number | null>(null);
  const [returnEditError, setReturnEditError] = useState("");
  const [scheduleRecords, setScheduleRecords] = useState<LessonScheduleRecord[] | null>(null);
  const [isTutorReadOnly, setIsTutorReadOnly] = useState(false);
  const availableYears = useMemo(() => availableLessonYears(), []);
  const hubYear = defaultLessonYear();

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const email = String(auth.user?.email ?? "").trim().toLowerCase();
      if (!mounted) return;
      if (email && email === TUTOR_SHARED_IPAD_EMAIL.trim().toLowerCase()) {
        router.replace(defaultDailyTimetablePath());
        return;
      }
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("user_id", auth.user?.id ?? "")
        .maybeSingle();
      if (!mounted) return;
      if (String(profile?.role ?? "").toLowerCase() === "tutor") {
        setIsTutorReadOnly(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!rawId) return;
    if (isLegacyBmStudentId(rawId)) {
      router.replace(`/students/${encodeURIComponent(normalizeStudentId(rawId))}/lessons`);
    }
  }, [rawId, router]);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    setStudentLoaded(false);
    setStudentNotFound(false);
    setScheduleRecords(null);

    void (async () => {
      const [studentRes, visibility, periods, records, yearState] = await Promise.all([
        supabase
          .from("students")
          .select("id, name_zh, name_en, nickname_en, grade, school, textbook_publisher")
          .eq("id", studentId)
          .maybeSingle(),
        loadStudentVisibilityMode(studentId),
        loadStudentInactivePeriods(studentId),
        loadLessonScheduleRecords(studentId),
        loadLessonYearState(studentId, hubYear),
      ]);

      if (cancelled) return;

      const data = studentRes.data;
      if (!data) {
        setStudentSummary({
          id: studentId,
          nameZh: "",
          nameEn: "",
          nicknameEn: "",
          grade: "",
          school: "",
          textbookPublisher: "",
        });
        setStudentNotFound(true);
        setStudentLoaded(true);
        return;
      }

      setStudentSummary({
        id: data.id,
        nameZh: data.name_zh ?? "",
        nameEn: data.name_en ?? "",
        nicknameEn: data.nickname_en ?? "",
        grade: data.grade ?? "",
        school: data.school ?? "",
        textbookPublisher: data.textbook_publisher ?? "",
      });
      setStudentNotFound(false);
      setVisibilityMode(visibility.mode);
      setVisibilityEffectiveDate(visibility.effective_date || new Date().toISOString().slice(0, 10));
      setVisibilityReactivateDate(visibility.reactivate_date ?? "");
      setInactivePeriods(
        dedupeInactivePeriodRows(
          (periods ?? []).map((p) => ({
            id: p.id,
            start_date: String(p.start_date ?? ""),
            end_date: p.end_date ?? null,
            note: String(p.note ?? ""),
          })),
        ),
      );
      setReturnDraftByPeriodId(
        Object.fromEntries(
          (periods ?? [])
            .filter((p) => Number(p.id) > 0)
            .map((p) => [String(p.id), p.end_date ?? ""]),
        ),
      );
      setReturnEditError("");

      const metrics = getLessonUntickedMetrics(
        records as Parameters<typeof getLessonUntickedMetrics>[0],
        toLesson2026State(yearState),
      );
      setUpcomingUntickedCount(metrics.makeupCount);
      setCurrentMonthUntickedCount(metrics.currentMonthUntickedCount);
      setScheduleRecords(records as LessonScheduleRecord[]);
      setStudentLoaded(true);
      void saveLessonYearMetrics(
        studentId,
        hubYear,
        metrics.makeupCount,
        metrics.currentMonthUntickedCount,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [studentId, hubYear]);

  async function refreshInactivePeriodsAndMode() {
    if (!studentId) return;
    const [visibility, periods] = await Promise.all([
      loadStudentVisibilityMode(studentId),
      loadStudentInactivePeriods(studentId),
    ]);
    setVisibilityMode(visibility.mode);
    setVisibilityEffectiveDate(visibility.effective_date || new Date().toISOString().slice(0, 10));
    setVisibilityReactivateDate(visibility.reactivate_date ?? "");
    const mapped = dedupeInactivePeriodRows(
      (periods ?? []).map((p) => ({
        id: p.id,
        start_date: String(p.start_date ?? ""),
        end_date: p.end_date ?? null,
        note: String(p.note ?? ""),
      })),
    );
    setInactivePeriods(mapped);
    setReturnDraftByPeriodId(
      Object.fromEntries(
        mapped.filter((p) => Number(p.id) > 0).map((p) => [String(p.id), p.end_date ?? ""]),
      ),
    );
    setReturnEditError("");
  }

  async function saveHistoryReturnDate(period: {
    id?: number;
    start_date: string;
    end_date: string | null;
  }) {
    const id = Number(period.id);
    if (!Number.isFinite(id) || id <= 0) {
      setReturnEditError("This history row has no id and cannot be edited.");
      return;
    }
    const draft = (returnDraftByPeriodId[String(id)] ?? "").trim();
    if (draft && draft <= period.start_date) {
      setReturnEditError("Return must be after From (first day back at lessons).");
      return;
    }
    setReturnSavingPeriodId(id);
    setReturnEditError("");
    try {
      await updateStudentInactivePeriodEndDate({
        id,
        endDate: draft || null,
      });
      await refreshInactivePeriodsAndMode();
    } catch (err) {
      setReturnEditError(err instanceof Error ? err.message : "Failed to save return date.");
    } finally {
      setReturnSavingPeriodId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight={isTutorReadOnly ? "daily-timetable" : "students"} />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <div className="flex items-center gap-3">
              <Link
                href={isTutorReadOnly ? defaultDailyTimetablePath() : "/students"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xl font-bold leading-none hover:bg-white/30"
                aria-label={isTutorReadOnly ? "Back to daily timetable" : "Back to students list"}
              >
                ←
              </Link>
              <h1 className="text-2xl font-bold tracking-tight">Student Lesson Record</h1>
            </div>
            <p className="mt-1 text-sm text-blue-100">
              Student ID: {studentId || "—"} | Student:{" "}
              {formatStudentDisplayNameOrEmpty(
                {
                  id: studentSummary.id,
                  name_zh: studentSummary.nameZh,
                  name_en: studentSummary.nameEn,
                  nickname_en: studentSummary.nicknameEn,
                },
                "full",
                "—",
              )}
            </p>
          </div>

          {studentLoaded && studentNotFound && (
            <div className="mx-6 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Student record {studentId} was not found. You can still configure this page first, but we recommend adding the student in the Students page.
            </div>
          )}

          <div className="border-b border-slate-200 bg-slate-50 p-6">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">Student ID</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentId || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">Student Name</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {formatStudentDisplayNameOrEmpty(
                      {
                        id: studentSummary.id,
                        name_zh: studentSummary.nameZh,
                        name_en: studentSummary.nameEn,
                        nickname_en: studentSummary.nicknameEn,
                      },
                      "full",
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">Grade</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{formatGradeDisplay(studentSummary.grade) || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">School</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.school || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">Textbook publisher</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.textbookPublisher || "—"}</p>
                </div>
              </div>

              {!isTutorReadOnly ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[auto_1fr] md:items-start">
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">Student Mode (Global Visibility)</p>
                  <ClientOnlyAfterMount
                    fallback={
                      <div className="mt-1 flex flex-wrap items-center gap-2" aria-hidden>
                        <div className="h-10 w-[7.5rem] animate-pulse rounded-md bg-slate-200" />
                        <div className="h-10 w-40 animate-pulse rounded-md bg-slate-200" />
                        <div className="h-10 w-24 animate-pulse rounded-md bg-slate-200" />
                      </div>
                    }
                  >
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <select
                        value={visibilityMode}
                        onChange={(e) => {
                          const next = e.target.value === "inactive" ? "inactive" : "active";
                          setVisibilityMode(next);
                          if (next === "active") setVisibilityReactivateDate("");
                          if (next === "active") setVisibilityNote("");
                        }}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                      <label className="inline-flex flex-col gap-0.5">
                        <span className="text-[10px] font-semibold text-slate-500">Inactive from</span>
                        <input
                          type="date"
                          value={visibilityEffectiveDate}
                          onChange={(e) => setVisibilityEffectiveDate(e.target.value)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                        />
                      </label>
                      {visibilityMode === "inactive" ? (
                        <label className="inline-flex flex-col gap-0.5">
                          <span className="text-[10px] font-semibold text-slate-500">Expected return (optional)</span>
                          <input
                            type="date"
                            value={visibilityReactivateDate}
                            onChange={(e) => setVisibilityReactivateDate(e.target.value)}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                          />
                        </label>
                      ) : null}
                      {visibilityMode === "inactive" ? (
                        <label className="inline-flex flex-col gap-0.5">
                          <span className="text-[10px] font-semibold text-slate-500">Reason (optional)</span>
                          <input
                            type="text"
                            value={visibilityNote}
                            onChange={(e) => setVisibilityNote(e.target.value)}
                            placeholder="e.g. holiday / exam / family travel"
                            className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        disabled={visibilitySaving || !visibilityEffectiveDate}
                        onClick={() => {
                          if (!studentId || !visibilityEffectiveDate) return;
                          setVisibilitySaving(true);
                          void (async () => {
                            try {
                              await saveStudentVisibilityMode({
                                studentId,
                                mode: visibilityMode,
                                effectiveDate: visibilityEffectiveDate,
                                reactivateDate:
                                  visibilityMode === "inactive" ? visibilityReactivateDate || null : null,
                                note: visibilityMode === "inactive" ? visibilityNote || null : null,
                              });
                              await refreshInactivePeriodsAndMode();
                            } finally {
                              setVisibilitySaving(false);
                            }
                          })();
                        }}
                        className="inline-flex items-center gap-1.5 self-end rounded-md bg-[#1d76c2] px-3 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                          <path d="M3 4.5A1.5 1.5 0 014.5 3h8.44c.4 0 .78.16 1.06.44l2.06 2.06c.28.28.44.66.44 1.06V15.5A1.5 1.5 0 0115 17H4.5A1.5 1.5 0 013 15.5v-11zM5 5v3h7V5H5zm0 6.5A.5.5 0 015.5 11h9a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-4z" />
                        </svg>
                        <span suppressHydrationWarning>{visibilitySaving ? "Saving..." : "Save"}</span>
                      </button>
                    </div>
                  </ClientOnlyAfterMount>
                  <p className="mt-1 text-xs text-slate-500">
                    Inactive from 該日起，學生會從 Room、Daily Timetable、學費表、及該年課表（Inactive 期間的課）隱藏。Expected return 請填<strong>復課首日</strong>（例：7–8 月停 → 填 2026-09-01，唔好填 8/31）；到時請改回 Active。
                  </p>
                  {inactivePeriods.length > 0 ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 text-left"
                        onClick={() => setInactiveHistoryOpen((v) => !v)}
                        aria-expanded={inactiveHistoryOpen}
                      >
                        <span className="text-xs font-semibold tracking-wider text-slate-500">Inactive history</span>
                        <svg
                          viewBox="0 0 20 20"
                          className={`h-4 w-4 flex-none text-slate-500 transition-transform ${
                            inactiveHistoryOpen ? "rotate-90" : "rotate-0"
                          }`}
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          {/* Right-pointing triangle (rotate to point down when expanded) */}
                          <path d="M7.5 5.2a1 1 0 011.6-.8l7.1 4.9a1 1 0 010 1.6l-7.1 4.9a1 1 0 01-1.6-.8V5.2z" />
                        </svg>
                      </button>

                      {inactiveHistoryOpen ? (
                        <div className="mt-2 overflow-hidden rounded-md border border-slate-200">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-xs font-bold text-slate-600">
                              <tr className="divide-x divide-slate-200">
                                <th className="px-3 py-2 text-left">From</th>
                                <th className="px-3 py-2 text-left">Return</th>
                                <th className="px-3 py-2 text-left">Note</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {[...inactivePeriods]
                                .sort((a, b) => b.start_date.localeCompare(a.start_date))
                                .map((p) => {
                                  const periodId = Number(p.id);
                                  const canEdit = Number.isFinite(periodId) && periodId > 0;
                                  const draftKey = String(periodId);
                                  const draft = canEdit
                                    ? (returnDraftByPeriodId[draftKey] ?? p.end_date ?? "")
                                    : p.end_date ?? "";
                                  const hasReturn = Boolean(p.end_date);
                                  const dirty = canEdit && draft !== (p.end_date ?? "");
                                  const saving = returnSavingPeriodId === periodId;
                                  return (
                                    <tr
                                      key={p.id ?? `${p.start_date}-${p.end_date ?? "open"}-${p.note}`}
                                      className="divide-x divide-slate-100"
                                    >
                                      <td className="px-3 py-2 font-semibold text-slate-800">
                                        {p.start_date || "—"}
                                      </td>
                                      <td className="px-3 py-2 text-slate-700">
                                        {canEdit ? (
                                          <div className="flex flex-wrap items-center gap-2">
                                            <input
                                              type="date"
                                              value={draft}
                                              min={dayAfterIso(p.start_date) ?? undefined}
                                              onChange={(e) => {
                                                const next = e.target.value;
                                                setReturnDraftByPeriodId((prev) => ({
                                                  ...prev,
                                                  [draftKey]: next,
                                                }));
                                                setReturnEditError("");
                                              }}
                                              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
                                              aria-label={
                                                hasReturn
                                                  ? `Edit return date for inactive from ${p.start_date}`
                                                  : `Add return date for inactive from ${p.start_date}`
                                              }
                                            />
                                            <button
                                              type="button"
                                              disabled={saving || !dirty}
                                              onClick={() => void saveHistoryReturnDate(p)}
                                              className="rounded-md bg-[#1d76c2] px-2.5 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                              {saving ? "Saving…" : hasReturn ? "Save" : "Add"}
                                            </button>
                                          </div>
                                        ) : (
                                          p.end_date || "—"
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-slate-600">{p.note || ""}</td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                          {returnEditError ? (
                            <p className="border-t border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                              {returnEditError}
                            </p>
                          ) : null}
                          <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                            Return = first day back at lessons. Clear the date and Save to mark as open-ended
                            (graduated).
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <ExamDateField studentId={studentId} initialValue="" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex whitespace-nowrap rounded-md bg-amber-100 px-3 py-2 text-sm font-bold text-amber-800">
                        Makeup Count {upcomingUntickedCount}
                      </span>
                      <span className="inline-flex rounded-md bg-sky-100 px-3 py-2 text-sm font-bold text-sky-800">
                        Unattended This Month {currentMonthUntickedCount}
                      </span>
                      <Link
                        href={`/student-progress/${encodeURIComponent(studentId)}`}
                        className="inline-flex items-center rounded-md bg-[#1d76c2] px-3 py-2 text-sm font-bold text-white transition hover:opacity-90"
                      >
                        Student Progress
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex whitespace-nowrap rounded-md bg-amber-100 px-3 py-2 text-sm font-bold text-amber-800">
                    Makeup Count {upcomingUntickedCount}
                  </span>
                  <span className="inline-flex rounded-md bg-sky-100 px-3 py-2 text-sm font-bold text-sky-800">
                    Unattended This Month {currentMonthUntickedCount}
                  </span>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold tracking-wider text-slate-500">Year</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {availableYears.map((year) => (
                    <Link
                      key={year}
                      href={`/students/${studentId}/lessons/${year}`}
                      className="rounded-md bg-[#1d76c2] px-3 py-2 text-sm font-bold text-white transition hover:opacity-90"
                    >
                      {year}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {!isTutorReadOnly ? (
          <div className="p-6">
            <h2 className="mb-4 text-lg font-bold text-slate-900">Lesson Schedule Settings</h2>
            {scheduleRecords ? (
              <LessonScheduleGrid studentId={studentId} initialRecords={scheduleRecords} />
            ) : (
              <div className="h-48 animate-pulse rounded-xl bg-slate-100" aria-hidden />
            )}
          </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// StatCard 已移除（当前 UI 改为学生摘要 + 年份分组列表）
