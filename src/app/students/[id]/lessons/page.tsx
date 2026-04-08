"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  loadLesson2026State,
  loadLessonScheduleRecords,
  loadStudentVisibilityMode,
  saveStudentVisibilityMode,
  saveLesson2026Metrics,
} from "@/lib/studentLessonStorage";
import {
  getCurrentMonthUntickedCount,
  getUpcomingUntickedCount,
} from "@/lib/lesson2026Summary";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import AppTopNav from "@/components/AppTopNav";
import ExamDateField from "./ExamDateField";
import LessonScheduleGrid from "./LessonScheduleGrid";
import { isLegacyBmStudentId, normalizeStudentId } from "@/lib/studentId";

const PRIMARY_GRADIENT = "linear-gradient(to right, #1d76c2 0%, #1d76c2 100%)";

type StudentSummary = {
  id: string;
  nameZh: string;
  nameEn: string;
  nicknameEn: string;
  grade: string;
  school: string;
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
  });
  const [studentLoaded, setStudentLoaded] = useState(false);
  const [studentNotFound, setStudentNotFound] = useState(false);
  const [upcomingUntickedCount, setUpcomingUntickedCount] = useState(0);
  const [currentMonthUntickedCount, setCurrentMonthUntickedCount] = useState(0);
  const [visibilityMode, setVisibilityMode] = useState<"active" | "inactive">("active");
  const [visibilityEffectiveDate, setVisibilityEffectiveDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const availableYears = useMemo(() => {
    const startYear = 2026;
    const now = new Date();
    const currentYear = now.getFullYear();
    const openNextYear = now.getMonth() === 11 && now.getDate() >= 1;
    const maxYear = openNextYear ? currentYear + 1 : currentYear;
    if (maxYear < startYear) return [startYear];
    return Array.from({ length: maxYear - startYear + 1 }, (_, i) => startYear + i);
  }, []);

  useEffect(() => {
    if (!rawId) return;
    if (isLegacyBmStudentId(rawId)) {
      router.replace(`/students/${encodeURIComponent(normalizeStudentId(rawId))}/lessons`);
    }
  }, [rawId, router]);

  useEffect(() => {
    if (!studentId) return;
    setStudentLoaded(false);
    setStudentNotFound(false);
    const timer = window.setTimeout(() => {
      void (async () => {
        const { data } = await supabase
          .from("students")
          .select("id, name_zh, name_en, nickname_en, grade, school")
          .eq("id", studentId)
          .maybeSingle();

        if (!data) {
          setStudentSummary({
            id: studentId,
            nameZh: "",
            nameEn: "",
            nicknameEn: "",
            grade: "",
            school: "",
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
        });
        setStudentLoaded(true);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const mode = await loadStudentVisibilityMode(studentId);
        setVisibilityMode(mode.mode);
        setVisibilityEffectiveDate(mode.effective_date || new Date().toISOString().slice(0, 10));
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const [records, state] = await Promise.all([
          loadLessonScheduleRecords(studentId),
          loadLesson2026State(studentId),
        ]);

        const count = getUpcomingUntickedCount(
          records as Array<{
            effectiveDate?: string;
            weekday: string;
            time: string;
            room: string;
            tutor?: string;
            lessonSummary?: string;
            createdAt: number;
          }>,
          {
            attendance: state.attendance as Record<string, boolean>,
            hiddenDates: state.hiddenDates as Record<string, boolean>,
            overrides: state.overrides as Record<
              string,
              { time?: string; room?: string; tutor?: string; lessonSummary?: string }
            >,
            rescheduleEntries: state.rescheduleEntries as Array<{
              id: string;
              fromDate: string;
              toDate: string;
              time: string;
              room: string;
            }>,
            extraEntries: state.extraEntries as Array<{
              id: string;
              date: string;
              time: string;
              room: string;
            }>,
          },
        );
        const monthCount = getCurrentMonthUntickedCount(
          records as Array<{
            effectiveDate?: string;
            weekday: string;
            time: string;
            room: string;
            tutor?: string;
            lessonSummary?: string;
            createdAt: number;
          }>,
          {
            attendance: state.attendance as Record<string, boolean>,
            hiddenDates: state.hiddenDates as Record<string, boolean>,
            overrides: state.overrides as Record<
              string,
              { time?: string; room?: string; tutor?: string; lessonSummary?: string }
            >,
            rescheduleEntries: state.rescheduleEntries as Array<{
              id: string;
              fromDate: string;
              toDate: string;
              time: string;
              room: string;
            }>,
            extraEntries: state.extraEntries as Array<{
              id: string;
              date: string;
              time: string;
              room: string;
            }>,
          },
        );
        setUpcomingUntickedCount(count);
        setCurrentMonthUntickedCount(monthCount);
        void saveLesson2026Metrics(studentId, count, monthCount);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studentId]);

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="students" />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <div className="flex items-center gap-3">
              <Link
                href="/students"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xl font-bold leading-none hover:bg-white/30"
                aria-label="返回學生列表"
              >
                ←
              </Link>
              <h1 className="text-2xl font-bold tracking-tight">學生獨立課堂記錄</h1>
            </div>
            <p className="mt-1 text-sm text-blue-100">
              學號：{studentId || "—"} | 學生：{" "}
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
              找不到學號 {studentId} 的學生資料。你仍可先設定資料，但建議先到 Students 頁新增該學生。
            </div>
          )}

          <div className="border-b border-slate-200 bg-slate-50 p-6">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">學號</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentId || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">學生姓名</p>
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
                  <p className="text-xs font-semibold tracking-wider text-slate-500">就讀年級</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.grade || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">就讀學校</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{studentSummary.school || "—"}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">學生模式（全系統顯示）</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <select
                      value={visibilityMode}
                      onChange={(e) => setVisibilityMode(e.target.value === "inactive" ? "inactive" : "active")}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    <input
                      type="date"
                      value={visibilityEffectiveDate}
                      onChange={(e) => setVisibilityEffectiveDate(e.target.value)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    />
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
                            });
                          } finally {
                            setVisibilitySaving(false);
                          }
                        })();
                      }}
                      className="rounded-md bg-[#1d76c2] px-3 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {visibilitySaving ? "儲存中..." : "儲存 Mode"}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Inactive 於生效日開始，會在 `rooms`、`daily-time-table`、`students-lesson-time-fee-record` 隱藏。
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold tracking-wider text-slate-500">最近考試日期</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <ExamDateField studentId={studentId} initialValue="" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex whitespace-nowrap rounded-md bg-amber-100 px-3 py-2 text-sm font-bold text-amber-800">
                        補堂數目 {upcomingUntickedCount}
                      </span>
                      <span className="inline-flex rounded-md bg-sky-100 px-3 py-2 text-sm font-bold text-sky-800">
                        當月未上堂數 {currentMonthUntickedCount}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold tracking-wider text-slate-500">年份</p>
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

          <div className="p-6">
            <h2 className="mb-4 text-lg font-bold text-slate-900">上課時段設定</h2>
            <LessonScheduleGrid studentId={studentId} />
          </div>
        </div>
      </div>
    </div>
  );
}

// StatCard 已移除（当前 UI 改为学生摘要 + 年份分组列表）
