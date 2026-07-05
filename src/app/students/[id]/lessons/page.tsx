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
  loadStudentVisibilityMode,
  saveStudentVisibilityMode,
  saveLessonYearMetrics,
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

const LessonScheduleGrid = dynamic(() => import("./LessonScheduleGrid"), {
  ssr: false,
  loading: () => <div className="h-48 animate-pulse rounded-xl bg-slate-100" aria-hidden />,
});

const PRIMARY_GRADIENT = "linear-gradient(to right, #1d76c2 0%, #1d76c2 100%)";

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
  const [visibilitySaving, setVisibilitySaving] = useState(false);
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
      const [studentRes, visibility, records, yearState] = await Promise.all([
        supabase
          .from("students")
          .select("id, name_zh, name_en, nickname_en, grade, school, textbook_publisher")
          .eq("id", studentId)
          .maybeSingle(),
        loadStudentVisibilityMode(studentId),
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
                              });
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
                    Inactive from 該日起，學生會從 Room、Daily Timetable、學費表隱藏。選填「Expected return」會喺 Home 提醒復課；真正返嚟時請改回 Active。
                  </p>
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
