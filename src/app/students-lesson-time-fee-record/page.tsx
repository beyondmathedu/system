/* eslint-disable react/no-array-index-key */
"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppTopNav from "@/components/AppTopNav";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { supabase } from "@/lib/supabase";
import {
  loadLessonScheduleRecordsBatch,
  loadLessonYearStatesBatch,
  loadStudentMonthlyFeeRecords,
  upsertStudentMonthlyFeeRecord,
} from "@/lib/studentLessonStorage";
import { readMonthPart, readYmdParts } from "@/lib/intlFormatParts";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";
import { normalizeStudentId } from "@/lib/studentId";

type StudentRow = {
  id: string;
  name_zh: string;
  name_en: string;
  nickname_en: string;
  grade: string;
};

const L_COUNT = 9;
const START_YEAR = 2026;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hkMonthNow(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
  }).formatToParts(new Date());
  return Number(readMonthPart(parts, "1")) || 1;
}

function hkTodayYmd() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const { y: ys, m: ms, d: ds } = readYmdParts(parts, { y: "2026", m: "01", d: "01" });
  return { y: Number(ys) || 2026, m: Number(ms) || 1, d: Number(ds) || 1 };
}

function monthEndIso(year: number, month1to12: number) {
  const day = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  return `${year}-${String(month1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const defaultRecordState = (): RecordState => ({
  weekday: "",
  expected: 0,
  submitted: 0,
  lValues: Array.from({ length: L_COUNT }, () => 0),
  remedialCount: 0,
  remarks: "",
  sendFee: false,
});

type RecordState = {
  weekday: string;
  expected: number;
  submitted: number;
  lValues: number[];
  remedialCount: number;
  remarks: string;
  sendFee: boolean;
};

type LessonRecord = {
  effectiveDate?: string;
  weekday: string;
  createdAt: number;
};

type SortDirection = "asc" | "desc";
type SortKey = "id" | "name" | "grade" | "weekday" | "expected" | "submitted";
type SortConfig = { key: SortKey; direction: SortDirection } | null;

export default function StudentsLessonTimeFeeRecordPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [sheetMonth, setSheetMonth] = useState(() => hkMonthNow());
  const availableYears = useMemo(() => {
    const now = hkTodayYmd();
    const openNextYear = now.m === 12 && now.d >= 1;
    const maxYear = openNextYear ? now.y + 1 : now.y;
    if (maxYear < START_YEAR) return [START_YEAR];
    return Array.from({ length: maxYear - START_YEAR + 1 }, (_, i) => START_YEAR + i);
  }, []);
  const [sheetYear, setSheetYear] = useState(() => {
    const now = hkTodayYmd();
    return Math.max(START_YEAR, now.y);
  });
  const [recordsByStudentId, setRecordsByStudentId] = useState<Record<string, RecordState>>({});
  const [lessonRecordsByStudentId, setLessonRecordsByStudentId] = useState<
    Record<string, LessonRecord[]>
  >({});
  const [extraEntriesByStudentId, setExtraEntriesByStudentId] = useState<
    Record<string, { date: string }[]>
  >({});
  const [remedialCountByStudentId, setRemedialCountByStudentId] = useState<Record<string, number>>(
    {},
  );
  const saveTimersRef = useState(() => new Map<string, number>())[0];

  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [{ data }, { data: visibilityRows }] = await Promise.all([
        supabase.from("students").select("id, name_zh, name_en, nickname_en, grade").order("id"),
        supabase.from("student_visibility_modes").select("student_id, mode, effective_date"),
      ]);
      if (!mounted) return;
      const cutoff = monthEndIso(sheetYear, Number(sheetMonth));
      const manualInactiveEffectiveById = new Map<string, string>();
      for (const row of visibilityRows ?? []) {
        const mode = String((row as any).mode ?? "active").toLowerCase();
        if (mode !== "inactive") continue;
        const sid = String((row as any).student_id ?? "");
        const eff = String((row as any).effective_date ?? "");
        if (sid && eff) manualInactiveEffectiveById.set(sid, eff);
      }
      const mapped: StudentRow[] = (data ?? []).map((r) => ({
        id: r.id,
        name_zh: String(r.name_zh ?? ""),
        name_en: String(r.name_en ?? ""),
        nickname_en: String(r.nickname_en ?? ""),
        grade: String(r.grade ?? ""),
      }))
      .filter((s) => {
        const eff = resolveStudentInactiveEffectiveDate({
          grade: s.grade,
          manualInactiveEffective: manualInactiveEffectiveById.get(s.id) ?? null,
          year: sheetYear,
        });
        return !(eff && eff <= cutoff);
      });
      setStudents(mapped);

      setRecordsByStudentId((prev) => {
        const next = { ...prev };
        for (const st of mapped) {
          if (!next[st.id]) next[st.id] = defaultRecordState();
        }
        return next;
      });
    })();

    return () => {
      mounted = false;
    };
  }, [sheetMonth, sheetYear]);

  useEffect(() => {
    if (students.length === 0) return;
    let mounted = true;
    void (async () => {
      const { data, error } = await supabase
        .from("student_lessons_2026_metrics")
        .select("student_id, remedial_count")
        .in(
          "student_id",
          students.map((s) => s.id),
        );
      if (!mounted) return;
      if (error) return;
      const next: Record<string, number> = {};
      for (const row of data ?? []) {
        next[String((row as any).student_id)] = Number((row as any).remedial_count ?? 0) || 0;
      }
      setRemedialCountByStudentId(next);
    })();
    return () => {
      mounted = false;
    };
  }, [students]);

  useEffect(() => {
    if (students.length === 0) return;
    let mounted = true;
    void (async () => {
      const rows = await loadStudentMonthlyFeeRecords({
        studentIds: students.map((s) => s.id),
        year: sheetYear,
        month: Number(sheetMonth),
      });
      if (!mounted) return;
      setRecordsByStudentId((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          const id = r.student_id;
          if (!next[id]) next[id] = defaultRecordState();
          next[id] = {
            ...next[id],
            submitted: Number(r.submitted_amount ?? 0) || 0,
            remarks: String(r.remarks ?? ""),
            sendFee: Boolean(r.send_fee),
          };
        }
        return next;
      });
    })();
    return () => {
      mounted = false;
    };
  }, [students, sheetMonth, sheetYear]);

  function scheduleSave(studentId: string, patch: Partial<RecordState>) {
    const key = `${studentId}:${sheetYear}:${sheetMonth}`;
    const existing = saveTimersRef.get(key);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      saveTimersRef.delete(key);
      const rec = recordsByStudentId[studentId] ?? defaultRecordState();
      const merged = { ...rec, ...patch };
      void upsertStudentMonthlyFeeRecord({
        studentId,
        year: sheetYear,
        month: Number(sheetMonth),
        submittedAmount: Number(merged.submitted ?? 0) || 0,
        remarks: String(merged.remarks ?? ""),
        sendFee: Boolean(merged.sendFee),
      });
    }, 600);
    saveTimersRef.set(key, t);
  }

  const sortedStudents = useMemo(() => {
    const gradeOrder: Record<string, number> = {
      中一: 1,
      中二: 2,
      中三: 3,
      中四: 4,
      中五: 5,
      中六: 6,
    };

    const getRec = (id: string) => recordsByStudentId[id];

    return [...students].sort((a, b) => {
      // 默认：中一->中六，再按學號
      if (!sortConfig) {
        const ga = gradeOrder[a.grade] ?? 999;
        const gb = gradeOrder[b.grade] ?? 999;
        if (ga !== gb) return ga - gb;
        return a.id.localeCompare(b.id);
      }

      const multiplier = sortConfig.direction === "asc" ? 1 : -1;
      const ra = getRec(a.id);
      const rb = getRec(b.id);

      let result = 0;
      switch (sortConfig.key) {
        case "id":
          result = a.id.localeCompare(b.id);
          break;
        case "name":
          result = (a.name_zh ?? "").localeCompare(b.name_zh ?? "", "zh-Hant");
          break;
        case "grade":
          result = (gradeOrder[a.grade] ?? 999) - (gradeOrder[b.grade] ?? 999);
          break;
        case "weekday":
          result = (ra?.weekday ?? "").localeCompare(rb?.weekday ?? "", "zh-Hant");
          break;
        case "expected":
          result = (ra?.expected ?? 0) - (rb?.expected ?? 0);
          break;
        case "submitted":
          result = (ra?.submitted ?? 0) - (rb?.submitted ?? 0);
          break;
        default:
          result = 0;
      }

      return result * multiplier;
    });
  }, [students, recordsByStudentId, sortConfig]);

  const updateStudentRecord = (studentId: string, patch: Partial<RecordState>) => {
    setRecordsByStudentId((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] ?? defaultRecordState()),
        ...patch,
      },
    }));
  };

  const onSubmittedChange = useCallback(
    (studentId: string, submitted: number) => {
      updateStudentRecord(studentId, { submitted });
      scheduleSave(studentId, { submitted });
    },
    [scheduleSave],
  );

  const onRemarksChange = useCallback(
    (studentId: string, remarks: string) => {
      updateStudentRecord(studentId, { remarks });
      scheduleSave(studentId, { remarks });
    },
    [scheduleSave],
  );

  const onSendFeeChange = useCallback(
    (studentId: string, sendFee: boolean) => {
      updateStudentRecord(studentId, { sendFee });
      scheduleSave(studentId, { sendFee });
    },
    [scheduleSave],
  );

  const onSyncZohoSubmitted = useCallback(async () => {
    setSyncingZoho(true);
    setSyncNotice("");
    try {
      const ctl = new AbortController();
      const timeout = window.setTimeout(() => ctl.abort(), 90000);
      const resp = await fetch("/api/zoho/sync-submitted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: sheetYear, month: Number(sheetMonth) }),
        signal: ctl.signal,
      });
      window.clearTimeout(timeout);
      const json = await resp.json();
      if (!resp.ok || !json?.ok) {
        throw new Error(String(json?.error ?? "sync_failed"));
      }
      const monthMap = (json?.monthSubmittedByStudentId ?? {}) as Record<string, number>;
      if (Object.keys(monthMap).length > 0) {
        setRecordsByStudentId((prev) => {
          const next = { ...prev };
          for (const [sid, submitted] of Object.entries(monthMap)) {
            next[sid] = {
              ...(next[sid] ?? defaultRecordState()),
              submitted: Number(submitted) || 0,
            };
          }
          return next;
        });
      }
      setSyncNotice(
        `已同步 Zoho（${sheetYear} 年），抓到 ${Number(json?.fetchedReceipts ?? 0)} 張收據；更新 ${Number(json?.syncedRows ?? 0)} 筆；未匹配 ${Number(json?.unmatchedReceipts ?? 0)} 張。${
          Array.isArray(json?.unmatchedExamples) && json.unmatchedExamples.length
            ? ` 未匹配例子：${json.unmatchedExamples.join(" / ")}`
            : ""
        }`,
      );
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("aborted")) {
        setSyncNotice("同步逾時（>90秒），請再試一次。系統已改為批量同步，通常第二次會更快。");
      } else {
        setSyncNotice(`同步失敗：${msg}`);
      }
    } finally {
      setSyncingZoho(false);
    }
  }, [sheetMonth, sheetYear]);

  function toHkIsoDateFromMs(msOrIso: number | string | Date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(msOrIso));

    const { y, m, d } = readYmdParts(parts);
    return `${y}-${m}-${d}`;
  }

  function getActiveWeekday(records: LessonRecord[], dateIso: string) {
    if (!records.length) return "";
    const normalized = records
      .map((r) => {
        const rr = r as unknown as Record<string, unknown>;
        const weekday =
          String(rr.weekday ?? rr.week_day ?? rr.weekDay ?? rr.Weekday ?? "") || "";

        const effectiveDate =
          (typeof rr.effectiveDate === "string"
            ? rr.effectiveDate
            : typeof rr.effective_date === "string"
              ? rr.effective_date
              : undefined) ?? toHkIsoDateFromMs((rr.createdAt ?? rr.created_at) as any);

        const createdAtNum =
          typeof rr.createdAt === "number"
            ? rr.createdAt
            : typeof rr.created_at === "number"
              ? rr.created_at
              : Number(rr.createdAt ?? rr.created_at ?? 0);

        return {
          weekday,
          effectiveDate: String(effectiveDate),
          createdAt: Number.isFinite(createdAtNum) ? createdAtNum : 0,
        };
      })
      .filter((x) => x.weekday);

    normalized.sort((a, b) => {
      const ed = a.effectiveDate.localeCompare(b.effectiveDate);
      if (ed !== 0) return ed;
      return a.createdAt - b.createdAt;
    });

    let active: LessonRecord | null = null;
    for (const r of normalized) {
      if (r.effectiveDate <= dateIso) {
        // active 只需要 weekday，所以用 normalized 的結構即可
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        active = r as unknown as LessonRecord;
      }
    }

    return (active as unknown as { weekday: string } | null)?.weekday ?? "";
  }

  const HK_WEEKDAY_SHORT_TO_CN: Record<string, string> = {
    Mon: "一",
    Tue: "二",
    Wed: "三",
    Thu: "四",
    Fri: "五",
    Sat: "六",
    Sun: "日",
  };

  function countHkWeekdaysInMonth(year: number, month1to12: number) {
    const counts: Record<string, number> = {
      一: 0,
      二: 0,
      三: 0,
      四: 0,
      五: 0,
      六: 0,
      日: 0,
    };

    // 用 UTC 算天數避免本地時區影響「月有幾天」
    const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();

    // 逐日用 HK 時區判斷星期，確保和你預期一致（避免伺服器/電腦時區差異）
    const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Hong_Kong",
      weekday: "short",
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(year, month1to12 - 1, d, 12)); // midday，避免跨日邊界
      const short = weekdayFormatter.format(dt);
      const cn = HK_WEEKDAY_SHORT_TO_CN[short];
      if (cn) counts[cn] += 1;
    }

    return counts;
  }

  useEffect(() => {
    if (students.length === 0) return;
    let mounted = true;
    void (async () => {
      const ids = students.map((s) => s.id);
      const [recordsMap, yearStatesMap] = await Promise.all([
        loadLessonScheduleRecordsBatch(ids),
        loadLessonYearStatesBatch(ids, sheetYear),
      ]);

      if (!mounted) return;

      const nextRecords: Record<string, LessonRecord[]> = {};
      const nextExtra: Record<string, { date: string }[]> = {};
      for (const st of students) {
        const id = st.id;
        let records: LessonRecord[] = [];
        const rawCloudRecords = recordsMap[id];
        if (Array.isArray(rawCloudRecords) && rawCloudRecords.length > 0) {
          records = rawCloudRecords as LessonRecord[];
        } else {
          // fallback: localStorage (無雲端資料時)
          try {
            const key = `lesson_schedule_records:${id}`;
            const raw = window.localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw) as unknown;
              if (Array.isArray(parsed)) records = parsed as LessonRecord[];
            }
          } catch {
            // ignore
          }
        }
        nextRecords[id] = records;

        const yearState = yearStatesMap[id];
        const extraEntriesRaw =
          (yearState?.extraEntries as Array<{ id: string; date: string; time: string; room: string }>) ??
          [];
        nextExtra[id] = extraEntriesRaw.map((e) => ({ date: e.date }));
      }
      setLessonRecordsByStudentId(nextRecords);
      setExtraEntriesByStudentId(nextExtra);
    })();

    return () => {
      mounted = false;
    };
  }, [students, sheetYear]);

  const weekdayCountsInSelectedMonth = useMemo(() => {
    return countHkWeekdaysInMonth(sheetYear, Number(sheetMonth));
  }, [sheetMonth, sheetYear]);

  const baseLessonDatesByWeekday = useMemo(() => {
    const out: Record<string, string[]> = {
      一: [],
      二: [],
      三: [],
      四: [],
      五: [],
      六: [],
      日: [],
    };
    const daysInMonth = new Date(Date.UTC(sheetYear, Number(sheetMonth), 0)).getUTCDate();
    const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Hong_Kong",
      weekday: "short",
    });
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(sheetYear, Number(sheetMonth) - 1, d, 12));
      const short = weekdayFormatter.format(dt);
      const cn = HK_WEEKDAY_SHORT_TO_CN[short];
      if (cn) out[cn].push(`${Number(sheetMonth)}/${d}`);
    }
    return out;
  }, [sheetYear, sheetMonth]);

  const lessonDatesByStudentId = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const st of students) {
      const r = recordsByStudentId[st.id] ?? defaultRecordState();
      const weekday = r.weekday;
      const base = weekday ? [...(baseLessonDatesByWeekday[weekday] ?? [])] : [];
      const extraEntries = extraEntriesByStudentId[st.id] ?? [];
      for (const e of extraEntries) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
        if (!m) continue;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        if (y === sheetYear && mo === Number(sheetMonth)) {
          base.push(`${mo}/${d}`);
        }
      }
      base.sort((a, b) => {
        const [am, ad] = a.split("/").map((v) => Number(v));
        const [bm, bd] = b.split("/").map((v) => Number(v));
        if (am !== bm) return am - bm;
        return ad - bd;
      });
      out[st.id] = base.slice(0, L_COUNT);
    }
    return out;
  }, [students, recordsByStudentId, extraEntriesByStudentId, baseLessonDatesByWeekday, sheetYear, sheetMonth]);

  useEffect(() => {
    if (students.length === 0) return;
    if (Object.keys(lessonRecordsByStudentId).length === 0) return;

    // 「星期」以學生目前設定（今天的 active rule）為準
    const todayIso = toHkIsoDateFromMs(Date.now());

    setRecordsByStudentId((prev) => {
      const next = { ...prev };
      for (const st of students) {
        if (!next[st.id]) next[st.id] = defaultRecordState();
        const records = lessonRecordsByStudentId[st.id] ?? [];
        const weekday = getActiveWeekday(records, todayIso);
        const finalWeekday = weekday || next[st.id].weekday;
         const extraEntries = extraEntriesByStudentId[st.id] ?? [];
         const extraCount = extraEntries.filter((e) => {
           const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
           if (!m) return false;
           const y = Number(m[1]);
           const mo = Number(m[2]);
           return y === sheetYear && mo === Number(sheetMonth);
         }).length;

         const baseExpected = finalWeekday ? weekdayCountsInSelectedMonth[finalWeekday] ?? 0 : 0;
        next[st.id] = {
          ...next[st.id],
          weekday: finalWeekday,
          // 應交 = 恆常堂數 + 本月加堂數目
          expected: baseExpected + extraCount,
        };
      }
      return next;
    });
  }, [students, lessonRecordsByStudentId, weekdayCountsInSelectedMonth, extraEntriesByStudentId, sheetMonth, sheetYear]);

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">學生上課時間及學費記錄</h1>
            <p className="mt-1 text-sm text-blue-100">學生上課時間及學費記錄</p>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-600">年份：</span>
                <span className="rounded-lg bg-[#1d76c2] px-2.5 py-1 text-sm font-semibold text-white">
                  {sheetYear}
                </span>
                <div className="ml-2 flex flex-wrap gap-1.5">
                  {availableYears.map((y) => {
                    const active = y === sheetYear;
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setSheetYear(y)}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          active
                            ? "bg-slate-800 text-white"
                            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
                <span className="ml-1 text-sm font-semibold text-slate-800">{sheetMonth} 月</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MONTH_SHORT.map((label, i) => {
                  const m = i + 1;
                  const active = m === sheetMonth;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setSheetMonth(m)}
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        active
                          ? "bg-slate-800 text-white"
                          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-bold text-slate-700">
                  {sheetYear} 年 / {sheetMonth} 月 / 記錄表
                </div>
                <button
                  type="button"
                  onClick={() => void onSyncZohoSubmitted()}
                  disabled={syncingZoho}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {syncingZoho ? "同步中..." : "Sync Zoho Receipts"}
                </button>
              </div>
              {syncNotice ? (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {syncNotice}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="bm-freeze-table min-w-[1900px] w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-700">
                      <SortableHeader label="學號" columnKey="id" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                      <SortableHeader label="姓名" columnKey="name" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                      <SortableHeader label="年級" columnKey="grade" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                      <SortableHeader label="星期" columnKey="weekday" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                      <SortableHeader label="應交" columnKey="expected" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                      <SortableHeader label="已交" columnKey="submitted" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                      {Array.from({ length: L_COUNT }, (_, i) => (
                        <th key={i} className="whitespace-nowrap px-2 py-3 text-center text-[11px]">
                          L{i + 1}
                        </th>
                      ))}
                      <th className="whitespace-nowrap px-4 py-3 text-left">補堂數目</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left">Remarks</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left">月尾Send學費</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sortedStudents.map((st, index) => {
                      const r = recordsByStudentId[st.id] ?? defaultRecordState();
                      const underPaid = r.submitted < r.expected;
                      const lessonDatesSerialized = (lessonDatesByStudentId[st.id] ?? []).join("|");
                      const prev = index > 0 ? sortedStudents[index - 1] : null;
                      const showGradeSeparatorTop =
                        prev != null && prev.grade.trim() !== st.grade.trim();
                      return (
                        <StudentFeeRow
                          key={st.id}
                          student={st}
                          record={r}
                          underPaid={underPaid}
                          lessonDatesSerialized={lessonDatesSerialized}
                          remedialCount={remedialCountByStudentId[st.id] ?? 0}
                          showGradeSeparatorTop={showGradeSeparatorTop}
                          onSubmittedChange={onSubmittedChange}
                          onRemarksChange={onRemarksChange}
                          onSendFeeChange={onSendFeeChange}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-sm font-bold text-amber-800">* 需要你確認 L1~L9 各代表什麼（例如：日期/課節/應上幾節）。</div>
                <div className="mt-2 text-sm text-amber-900">* 確認後我就能把格子接到「自動計算上課時間與學費」的邏輯。</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type SortableHeaderProps = {
  label: string;
  columnKey: SortKey;
  sortConfig: SortConfig;
  setSortConfig: (config: SortConfig) => void;
};

type StudentFeeRowProps = {
  student: StudentRow;
  record: RecordState;
  underPaid: boolean;
  lessonDatesSerialized: string;
  remedialCount: number;
  /** 與上一列年級不同時，整列頂邊加較深分隔線 */
  showGradeSeparatorTop: boolean;
  onSubmittedChange: (studentId: string, submitted: number) => void;
  onRemarksChange: (studentId: string, remarks: string) => void;
  onSendFeeChange: (studentId: string, sendFee: boolean) => void;
};

const StudentFeeRow = memo(function StudentFeeRow({
  student,
  record,
  underPaid,
  lessonDatesSerialized,
  remedialCount,
  showGradeSeparatorTop,
  onSubmittedChange,
  onRemarksChange,
  onSendFeeChange,
}: StudentFeeRowProps) {
  const lessonDates = lessonDatesSerialized ? lessonDatesSerialized.split("|") : [];
  const studentIdDisplay = normalizeStudentId(student.id);

  return (
    <tr
      className={`divide-x divide-slate-100 ${
        underPaid ? "bg-amber-50 hover:bg-amber-100" : "bg-white hover:bg-slate-50"
      } ${showGradeSeparatorTop ? "border-t-2 border-slate-400" : ""}`}
    >
      <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
        <Link
          href={`/students/${encodeURIComponent(studentIdDisplay)}/lessons`}
          className="font-medium text-[#1d76c2] hover:underline"
        >
          {studentIdDisplay}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
        {formatStudentDisplayNameOrEmpty(
          {
            id: student.id,
            name_zh: student.name_zh,
            name_en: student.name_en,
            nickname_en: student.nickname_en,
          },
          "full",
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
        {student.grade || "—"}
      </td>

      <td className="px-2 py-3 text-center">
        <div className="w-14 text-center text-xs font-medium text-slate-800">{record.weekday || "—"}</div>
      </td>
      <td className="px-2 py-3 text-center">
        <input
          type="number"
          inputMode="numeric"
          value={record.expected}
          disabled
          className="w-14 bg-transparent px-0 py-1 text-xs font-semibold text-slate-800 text-center outline-none"
        />
      </td>
      <td className="px-2 py-3 text-center">
        <input
          type="number"
          inputMode="numeric"
          value={record.submitted}
          onChange={(e) => {
            const num = Number(e.target.value);
            onSubmittedChange(student.id, Number.isFinite(num) ? num : 0);
          }}
          className="w-14 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
        />
      </td>

      {Array.from({ length: L_COUNT }, (_, i) => (
        <td key={i} className="px-2 py-3 text-center">
          <div className="h-7 w-12 rounded bg-slate-50 px-1 text-center text-[11px] leading-6 text-slate-800">
            {lessonDates[i] ?? ""}
          </div>
        </td>
      ))}

      <td className="px-2 py-3 text-center">
        <div className="w-16 text-center text-xs font-semibold text-slate-800">{remedialCount}</div>
      </td>

      <td className="px-2 py-3">
        <input
          type="text"
          value={record.remarks}
          onChange={(e) => onRemarksChange(student.id, e.target.value)}
          placeholder="備註"
          className="w-48 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
        />
      </td>

      <td className="px-2 py-3 text-center">
        <input
          type="checkbox"
          checked={record.sendFee}
          onChange={(e) => onSendFeeChange(student.id, e.target.checked)}
          className="h-4 w-4 accent-[#1d76c2]"
          aria-label={`${studentIdDisplay} 月尾送學費`}
        />
      </td>
    </tr>
  );
});

function SortableHeader({ label, columnKey, sortConfig, setSortConfig }: SortableHeaderProps) {
  const selectedDirection = sortConfig?.key === columnKey ? sortConfig.direction : "";

  return (
    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold tracking-wider text-slate-700">
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="whitespace-nowrap">{label}</span>
        <select
          aria-label={`${label} 排序`}
          value={selectedDirection}
          onChange={(event) => {
            const direction = event.target.value as SortDirection | "";
            if (!direction) {
              setSortConfig(null);
              return;
            }
            setSortConfig({ key: columnKey, direction });
          }}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-700"
        >
          <option value="">▽</option>
          <option value="asc">↑</option>
          <option value="desc">↓</option>
        </select>
      </div>
    </th>
  );
}

