/* eslint-disable react/no-array-index-key */
"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { formatGradeDisplay, gradeRank } from "@/lib/grade";

type StudentRow = {
  id: string;
  name_zh: string;
  name_en: string;
  nickname_en: string;
  grade: string;
};

const L_COUNT = 9;
const START_YEAR = 2026;
const STICKY_ID_WIDTH = 88;
const STICKY_NAME_WIDTH = 180;
const STICKY_GRADE_WIDTH = 84;
const WEEKDAY_COL_WIDTH = 86;
const TUITION_COL_WIDTH = 96;
const L_COL_WIDTH = 56;
const MAKEUP_COL_WIDTH = 110;
const SEND_FEE_COL_WIDTH = 88;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_ORDER: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
};
const HK_WEEKDAY_CN_TO_EN: Record<string, string> = {
  一: "Mon",
  二: "Tue",
  三: "Wed",
  四: "Thu",
  五: "Fri",
  六: "Sat",
  日: "Sun",
};

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
  const [submittedBeforeByStudentId, setSubmittedBeforeByStudentId] = useState<Record<string, number>>({});
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
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [weekdayFilter, setWeekdayFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "underpaid" | "ok">("all");
  const [sendFeeFilter, setSendFeeFilter] = useState<"all" | "yes" | "no">("all");
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomTrackRef = useRef<HTMLDivElement | null>(null);
  const sideTrackRef = useRef<HTMLDivElement | null>(null);
  const [bottomScrollWidth, setBottomScrollWidth] = useState(0);
  const [bottomScrollClientWidth, setBottomScrollClientWidth] = useState(0);
  const [sideScrollHeight, setSideScrollHeight] = useState(0);
  const [sideScrollClientHeight, setSideScrollClientHeight] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

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

  useEffect(() => {
    if (students.length === 0) {
      setSubmittedBeforeByStudentId({});
      return;
    }
    let mounted = true;
    void (async () => {
      const currentMonth = Number(sheetMonth);
      if (currentMonth <= 1) {
        setSubmittedBeforeByStudentId({});
        return;
      }
      const { data } = await supabase
        .from("student_monthly_fee_records")
        .select("student_id, submitted_amount")
        .eq("year", sheetYear)
        .lt("month", currentMonth)
        .in("student_id", students.map((s) => s.id));
      if (!mounted) return;
      const next: Record<string, number> = {};
      for (const r of data ?? []) {
        const sid = String((r as any).student_id ?? "");
        if (!sid) continue;
        next[sid] = (next[sid] ?? 0) + (Number((r as any).submitted_amount ?? 0) || 0);
      }
      setSubmittedBeforeByStudentId(next);
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
    const getRec = (id: string) => recordsByStudentId[id];

    return [...students].sort((a, b) => {
      // default: F1 -> F6, then by student ID
      if (!sortConfig) {
        const ga = gradeRank(a.grade);
        const gb = gradeRank(b.grade);
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
          result = gradeRank(a.grade) - gradeRank(b.grade);
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

  const weekdayTokensByStudentId = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const st of students) {
      out[st.id] = (recordsByStudentId[st.id]?.weekday ?? "")
        .split("/")
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return out;
  }, [students, recordsByStudentId]);

  const filteredSortedStudents = useMemo(() => {
    return sortedStudents.filter((st) => {
      const r = recordsByStudentId[st.id] ?? defaultRecordState();
      const matchesGrade = gradeFilter === "all" || formatGradeDisplay(st.grade) === gradeFilter;
      const matchesWeekday =
        weekdayFilter === "all" ||
        (weekdayTokensByStudentId[st.id] ?? []).includes(weekdayFilter);
      const matchesPayment =
        paymentFilter === "all" ||
        (paymentFilter === "underpaid" ? r.submitted < r.expected : r.submitted >= r.expected);
      const matchesSendFee =
        sendFeeFilter === "all" || (sendFeeFilter === "yes" ? Boolean(r.sendFee) : !r.sendFee);
      return matchesGrade && matchesWeekday && matchesPayment && matchesSendFee;
    });
  }, [
    sortedStudents,
    recordsByStudentId,
    gradeFilter,
    weekdayFilter,
    paymentFilter,
    sendFeeFilter,
    weekdayTokensByStudentId,
  ]);

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

  const syncZohoSubmitted = useCallback(
    async (opts?: { studentIds?: string[]; idOnly?: boolean }) => {
    setSyncingZoho(true);
    setSyncNotice("");
    try {
      const ctl = new AbortController();
      const timeout = window.setTimeout(() => ctl.abort(), 90000);
      const resp = await fetch("/api/zoho/sync-submitted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: sheetYear,
          month: Number(sheetMonth),
          studentIds: opts?.studentIds,
          idOnly: Boolean(opts?.idOnly),
        }),
        signal: ctl.signal,
      });
      window.clearTimeout(timeout);
      const json = await resp.json();
      if (!resp.ok || !json?.ok) {
        throw new Error(String(json?.error ?? "sync_failed"));
      }
      const debug = (json?.debug ?? {}) as {
        matchedReceipts?: number;
        totalLineItems?: number;
        parsedMonthLineItems?: number;
        detailCalls?: number;
        skippedDetailByLimit?: number;
        detailFetchSuccess?: number;
        detailFetchEmpty?: number;
        detailFetchError?: number;
        detailErrorSamples?: string[];
      };
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
        `Zoho synced (${sheetYear}). Fetched ${Number(json?.fetchedReceipts ?? 0)} receipts; updated ${Number(json?.syncedRows ?? 0)} rows; ${Number(json?.unmatchedReceipts ?? 0)} unmatched.${
          Array.isArray(json?.unmatchedExamples) && json.unmatchedExamples.length
            ? ` Unmatched examples: ${json.unmatchedExamples.join(" / ")}`
            : ""
        } Debug: matched ${Number(debug.matchedReceipts ?? 0)}, line items ${Number(debug.totalLineItems ?? 0)}, parsed-month items ${Number(debug.parsedMonthLineItems ?? 0)}, detail calls ${Number(debug.detailCalls ?? 0)}, skipped details ${Number(debug.skippedDetailByLimit ?? 0)}, detail success ${Number(debug.detailFetchSuccess ?? 0)}, detail empty ${Number(debug.detailFetchEmpty ?? 0)}, detail errors ${Number(debug.detailFetchError ?? 0)}${
          Array.isArray(debug.detailErrorSamples) && debug.detailErrorSamples.length
            ? `, detail error samples: ${debug.detailErrorSamples.join(" / ")}`
            : ""
        }.`,
      );
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("aborted")) {
        setSyncNotice("Sync timed out (>90s). Please try again. The system now syncs in batches, and the next attempt is usually faster.");
      } else {
        setSyncNotice(`Sync failed: ${msg}`);
      }
    } finally {
      setSyncingZoho(false);
    }
    },
    [sheetMonth, sheetYear],
  );

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

  function getActiveWeekdays(records: LessonRecord[], dateIso: string) {
    if (!records.length) return [] as string[];
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

    const activeByWeekday = new Map<string, LessonRecord>();
    for (const r of normalized) {
      if (r.effectiveDate <= dateIso) {
        activeByWeekday.set(r.weekday, r as unknown as LessonRecord);
      }
    }
    const weekdays = Array.from(activeByWeekday.keys()).filter(Boolean);
    weekdays.sort((a, b) => (WEEKDAY_ORDER[a] ?? 99) - (WEEKDAY_ORDER[b] ?? 99));
    return weekdays;
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

    // Use UTC for day count to avoid local timezone drift.
    const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();

    // Compute weekdays in HK timezone to avoid server/client timezone mismatch.
    const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Hong_Kong",
      weekday: "short",
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(year, month1to12 - 1, d, 12)); // midday to avoid date-boundary drift
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
          // fallback: localStorage (when no cloud records exist)
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

  const cumulativeWeekdayCountsBeforeSelectedMonth = useMemo(() => {
    const currentMonth = Number(sheetMonth);
    const out: Record<string, number> = { 一: 0, 二: 0, 三: 0, 四: 0, 五: 0, 六: 0, 日: 0 };
    if (currentMonth <= 1) return out;
    for (let m = 1; m < currentMonth; m += 1) {
      const monthCounts = countHkWeekdaysInMonth(sheetYear, m);
      out.一 += monthCounts.一 ?? 0;
      out.二 += monthCounts.二 ?? 0;
      out.三 += monthCounts.三 ?? 0;
      out.四 += monthCounts.四 ?? 0;
      out.五 += monthCounts.五 ?? 0;
      out.六 += monthCounts.六 ?? 0;
      out.日 += monthCounts.日 ?? 0;
    }
    return out;
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

  const extraEntryCountsByStudentId = useMemo(() => {
    const out: Record<string, { before: number; current: number }> = {};
    const currentMonth = Number(sheetMonth);
    for (const st of students) {
      out[st.id] = { before: 0, current: 0 };
      const extraEntries = extraEntriesByStudentId[st.id] ?? [];
      for (const e of extraEntries) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
        if (!m) continue;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        if (y !== sheetYear) continue;
        if (mo === currentMonth) out[st.id].current += 1;
        else if (mo < currentMonth) out[st.id].before += 1;
      }
    }
    return out;
  }, [students, extraEntriesByStudentId, sheetYear, sheetMonth]);

  const lessonDatesByStudentId = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const st of students) {
      const weekdays = weekdayTokensByStudentId[st.id] ?? [];
      const base: string[] = [];
      for (const wd of weekdays) {
        base.push(...(baseLessonDatesByWeekday[wd] ?? []));
      }
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
      out[st.id] = Array.from(new Set(base)).slice(0, L_COUNT);
    }
    return out;
  }, [
    students,
    weekdayTokensByStudentId,
    extraEntriesByStudentId,
    baseLessonDatesByWeekday,
    sheetYear,
    sheetMonth,
  ]);

  const expectedBeforeByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    const currentMonth = Number(sheetMonth);
    if (currentMonth <= 1) return out;
    for (const st of students) {
      const weekdays = weekdayTokensByStudentId[st.id] ?? [];
      const expected = weekdays.reduce(
        (sum, wd) => sum + (cumulativeWeekdayCountsBeforeSelectedMonth[wd] ?? 0),
        0,
      );
      const extraCountBefore = extraEntryCountsByStudentId[st.id]?.before ?? 0;
      out[st.id] = expected + extraCountBefore;
    }
    return out;
  }, [
    students,
    weekdayTokensByStudentId,
    extraEntryCountsByStudentId,
    sheetMonth,
    cumulativeWeekdayCountsBeforeSelectedMonth,
  ]);

  const balanceBeforeByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const st of students) {
      const expectedBefore = Number(expectedBeforeByStudentId[st.id] ?? 0) || 0;
      const submittedBefore = Number(submittedBeforeByStudentId[st.id] ?? 0) || 0;
      out[st.id] = expectedBefore - submittedBefore;
    }
    return out;
  }, [students, expectedBeforeByStudentId, submittedBeforeByStudentId]);

  const totalDueByStudentId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const st of students) {
      const currentExpected = Number(recordsByStudentId[st.id]?.expected ?? 0) || 0;
      const balanceBefore = Number(balanceBeforeByStudentId[st.id] ?? 0) || 0;
      out[st.id] = balanceBefore + currentExpected;
    }
    return out;
  }, [students, recordsByStudentId, balanceBeforeByStudentId]);

  useEffect(() => {
    if (students.length === 0) return;
    if (Object.keys(lessonRecordsByStudentId).length === 0) return;

    // Weekday uses student's current active rule (as of today).
    const todayIso = toHkIsoDateFromMs(Date.now());

    setRecordsByStudentId((prev) => {
      const next = { ...prev };
      for (const st of students) {
        if (!next[st.id]) next[st.id] = defaultRecordState();
        const records = lessonRecordsByStudentId[st.id] ?? [];
        const weekdays = getActiveWeekdays(records, todayIso);
        const finalWeekday =
          weekdays.length > 0
            ? weekdays.join("/")
            : next[st.id].weekday;
        const effectiveWeekdays = finalWeekday
          .split("/")
          .map((v) => v.trim())
          .filter(Boolean);
        const extraCount = extraEntryCountsByStudentId[st.id]?.current ?? 0;

        const baseExpected = effectiveWeekdays.reduce(
          (sum, wd) => sum + (weekdayCountsInSelectedMonth[wd] ?? 0),
          0,
        );
        next[st.id] = {
          ...next[st.id],
          weekday: finalWeekday,
          // Expected = regular lessons + extra lessons in this month.
          expected: baseExpected + extraCount,
        };
      }
      return next;
    });
  }, [
    students,
    lessonRecordsByStudentId,
    weekdayCountsInSelectedMonth,
    sheetMonth,
    sheetYear,
    extraEntryCountsByStudentId,
  ]);

  useEffect(() => {
    const tableEl = tableScrollRef.current;
    if (!tableEl) return;

    const updateMetrics = () => {
      setBottomScrollWidth(tableEl.scrollWidth);
      setBottomScrollClientWidth(tableEl.clientWidth);
      setSideScrollHeight(tableEl.scrollHeight);
      setSideScrollClientHeight(tableEl.clientHeight);
    };

    const onTableScroll = () => {
      setScrollLeft(tableEl.scrollLeft);
      setScrollTop(tableEl.scrollTop);
    };

    updateMetrics();
    setScrollLeft(tableEl.scrollLeft);
    setScrollTop(tableEl.scrollTop);
    tableEl.addEventListener("scroll", onTableScroll, { passive: true });
    const ro = new ResizeObserver(() => updateMetrics());
    ro.observe(tableEl);

    return () => {
      tableEl.removeEventListener("scroll", onTableScroll);
      ro.disconnect();
    };
  }, [sortedStudents.length, sheetYear, sheetMonth]);

  const bottomThumb = useMemo(() => {
    const trackEl = bottomTrackRef.current;
    const trackWidth = trackEl?.clientWidth ?? 0;
    if (!trackWidth || !bottomScrollWidth || !bottomScrollClientWidth) return { size: 0, offset: 0 };
    const ratio = bottomScrollClientWidth / bottomScrollWidth;
    const size = Math.max(28, Math.floor(trackWidth * ratio));
    const maxOffset = Math.max(0, trackWidth - size);
    const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);
    const offset = Math.round((scrollLeft / maxScroll) * maxOffset);
    return { size, offset };
  }, [bottomScrollClientWidth, bottomScrollWidth, scrollLeft]);

  const sideThumb = useMemo(() => {
    const trackEl = sideTrackRef.current;
    const trackHeight = trackEl?.clientHeight ?? 0;
    if (!trackHeight || !sideScrollHeight || !sideScrollClientHeight) return { size: 0, offset: 0 };
    const ratio = sideScrollClientHeight / sideScrollHeight;
    const size = Math.max(28, Math.floor(trackHeight * ratio));
    const maxOffset = Math.max(0, trackHeight - size);
    const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);
    const offset = Math.round((scrollTop / maxScroll) * maxOffset);
    return { size, offset };
  }, [sideScrollClientHeight, sideScrollHeight, scrollTop]);

  const onBottomTrackMouseDown = (e: React.MouseEvent) => {
    const track = bottomTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { size } = bottomThumb;
    const trackWidth = rect.width;
    const maxOffset = Math.max(0, trackWidth - size);
    const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);
    const targetOffset = Math.min(maxOffset, Math.max(0, x - size / 2));
    tableEl.scrollLeft = Math.round((targetOffset / Math.max(1, maxOffset)) * maxScroll);
  };

  const onSideTrackMouseDown = (e: React.MouseEvent) => {
    const track = sideTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const { size } = sideThumb;
    const trackHeight = rect.height;
    const maxOffset = Math.max(0, trackHeight - size);
    const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);
    const targetOffset = Math.min(maxOffset, Math.max(0, y - size / 2));
    tableEl.scrollTop = Math.round((targetOffset / Math.max(1, maxOffset)) * maxScroll);
  };

  const startDragBottomThumb = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = bottomTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const startX = e.clientX;
    const startOffset = bottomThumb.offset;
    const size = bottomThumb.size;
    const trackWidth = rect.width;
    const maxOffset = Math.max(0, trackWidth - size);
    const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const nextOffset = Math.min(maxOffset, Math.max(0, startOffset + dx));
      tableEl.scrollLeft = Math.round((nextOffset / Math.max(1, maxOffset)) * maxScroll);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startDragSideThumb = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = sideTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const startY = e.clientY;
    const startOffset = sideThumb.offset;
    const size = sideThumb.size;
    const trackHeight = rect.height;
    const maxOffset = Math.max(0, trackHeight - size);
    const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const nextOffset = Math.min(maxOffset, Math.max(0, startOffset + dy));
      tableEl.scrollTop = Math.round((nextOffset / Math.max(1, maxOffset)) * maxScroll);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">Student Lesson Time & Tuition Record</h1>
            <p className="mt-1 text-sm text-blue-100">Student Lesson Time & Tuition Record</p>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-600">Year:</span>
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
                <span className="ml-1 text-sm font-semibold text-slate-800">{MONTH_SHORT[sheetMonth - 1]}</span>
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
                <div>
                  <div className="text-sm font-bold text-slate-700">
                    {sheetYear} / {MONTH_SHORT[sheetMonth - 1]} / Record Sheet
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    Total Due includes previous balance (arrears or credit) plus current month due.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void syncZohoSubmitted({
                      studentIds: filteredSortedStudents.map((s) => s.id),
                      idOnly: true,
                    })
                  }
                  disabled={syncingZoho}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                    <path
                      transform="translate(0,-1.2)"
                      d="M4.08 11.86a5.5 5.5 0 019.27-3.59l-.94.94a.75.75 0 001.06 1.06l2.5-2.5a.75.75 0 000-1.06l-2.5-2.5a.75.75 0 00-1.06 1.06l.99.99a7 7 0 00-11.3 5.59.75.75 0 001.5 0z"
                    />
                    <path
                      transform="translate(0,1.2)"
                      d="M15.92 8.14a.75.75 0 00-1.5 0 5.5 5.5 0 01-9.27 3.59l.94-.94a.75.75 0 10-1.06-1.06l-2.5 2.5a.75.75 0 000 1.06l2.5 2.5a.75.75 0 001.06-1.06l-.99-.99a7 7 0 0011.3-5.59z"
                    />
                  </svg>
                  {syncingZoho ? "Syncing..." : "Sync Zoho Receipts"}
                </button>
              </div>
              <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                <label className="min-w-[120px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Grade</span>
                  <select
                    value={gradeFilter}
                    onChange={(e) => setGradeFilter(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                  >
                    <option value="all">All Grades</option>
                    <option value="F.1">F.1</option>
                    <option value="F.2">F.2</option>
                    <option value="F.3">F.3</option>
                    <option value="F.4">F.4</option>
                    <option value="F.5">F.5</option>
                    <option value="F.6">F.6</option>
                  </select>
                </label>
                <label className="min-w-[120px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Weekday</span>
                  <select
                    value={weekdayFilter}
                    onChange={(e) => setWeekdayFilter(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                  >
                    <option value="all">All</option>
                    <option value="一">Mon</option>
                    <option value="二">Tue</option>
                    <option value="三">Wed</option>
                    <option value="四">Thu</option>
                    <option value="五">Fri</option>
                    <option value="六">Sat</option>
                    <option value="日">Sun</option>
                  </select>
                </label>
                <label className="min-w-[140px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Payment Status</span>
                  <select
                    value={paymentFilter}
                    onChange={(e) => setPaymentFilter(e.target.value as "all" | "underpaid" | "ok")}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                  >
                    <option value="all">All</option>
                    <option value="underpaid">Underpaid</option>
                    <option value="ok">Expected Met</option>
                  </select>
                </label>
                <label className="min-w-[120px]">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Send Fee</span>
                  <select
                    value={sendFeeFilter}
                    onChange={(e) => setSendFeeFilter(e.target.value as "all" | "yes" | "no")}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                  >
                    <option value="all">All</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setGradeFilter("all");
                    setWeekdayFilter("all");
                    setPaymentFilter("all");
                    setSendFeeFilter("all");
                  }}
                  className="inline-flex items-center gap-1.5 rounded bg-[#1d76c2] px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1663a3]"
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                    <path
                      transform="translate(0,-1.8)"
                      d="M4.08 11.86a5.5 5.5 0 019.27-3.59l-.94.94a.75.75 0 001.06 1.06l2.5-2.5a.75.75 0 000-1.06l-2.5-2.5a.75.75 0 00-1.06 1.06l.99.99a7 7 0 00-11.3 5.59.75.75 0 001.5 0z"
                    />
                    <path
                      transform="translate(0,1.8)"
                      d="M15.92 8.14a.75.75 0 00-1.5 0 5.5 5.5 0 01-9.27 3.59l.94-.94a.75.75 0 10-1.06-1.06l-2.5 2.5a.75.75 0 000 1.06l2.5 2.5a.75.75 0 001.06-1.06l-.99-.99a7 7 0 0011.3-5.59z"
                    />
                  </svg>
                  Reset Filters
                </button>
                <div className="ml-auto text-xs text-slate-600">
                  Showing <span className="font-semibold text-slate-800">{filteredSortedStudents.length}</span> /{" "}
                  <span className="font-semibold text-slate-800">{sortedStudents.length}</span>
                </div>
              </div>
              {syncNotice ? (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {syncNotice}
                </div>
              ) : null}

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div className="flex">
                  <div
                    ref={tableScrollRef}
                    className="max-h-[70vh] flex-1 overflow-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    <table className="min-w-[1900px] w-full border-collapse text-left text-sm">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-200 text-xs font-bold tracking-wider text-slate-700">
                          <SortableHeader
                            label="ID"
                            columnKey="id"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thClassName="left-0 z-40"
                            thStyle={{ left: 0, minWidth: STICKY_ID_WIDTH }}
                          />
                          <SortableHeader
                            label="Name"
                            columnKey="name"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thClassName="z-40"
                            thStyle={{ left: STICKY_ID_WIDTH, minWidth: STICKY_NAME_WIDTH }}
                          />
                          <SortableHeader
                            label="Grade"
                            columnKey="grade"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thClassName="z-40 border-r border-slate-200"
                            thStyle={{
                              left: STICKY_ID_WIDTH + STICKY_NAME_WIDTH,
                              minWidth: STICKY_GRADE_WIDTH,
                            }}
                          />
                          <SortableHeader
                            label="Weekday"
                            columnKey="weekday"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thStyle={{ minWidth: WEEKDAY_COL_WIDTH }}
                          />
                          <SortableHeader
                            label="Total Due"
                            sublabel="Previous Balance + This Month"
                            columnKey="expected"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thStyle={{ minWidth: TUITION_COL_WIDTH }}
                          />
                          <SortableHeader
                            label="Tuition Paid"
                            columnKey="submitted"
                            sortConfig={sortConfig}
                            setSortConfig={setSortConfig}
                            thStyle={{ minWidth: TUITION_COL_WIDTH }}
                          />
                          {Array.from({ length: L_COUNT }, (_, i) => (
                            <th
                              key={i}
                              className="sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-2 py-3 text-center text-[11px]"
                              style={{ minWidth: L_COL_WIDTH }}
                            >
                              L{i + 1}
                            </th>
                          ))}
                          <th
                            className="sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-4 py-3 text-left"
                            style={{ minWidth: MAKEUP_COL_WIDTH }}
                          >
                            Makeup Count
                          </th>
                          <th className="sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-4 py-3 text-left">Remarks</th>
                          <th
                            className="sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-4 py-3 text-left"
                            style={{ minWidth: SEND_FEE_COL_WIDTH }}
                          >
                            Send Fee
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredSortedStudents.map((st, index) => {
                          const r = recordsByStudentId[st.id] ?? defaultRecordState();
                          const arrearsDue =
                            (expectedBeforeByStudentId[st.id] ?? 0) - (submittedBeforeByStudentId[st.id] ?? 0);
                          const totalDue = totalDueByStudentId[st.id] ?? r.expected;
                          const underPaid = r.submitted < totalDue;
                          const balanceCarryForward = totalDue - r.submitted;
                          const lessonDatesSerialized = (lessonDatesByStudentId[st.id] ?? []).join("|");
                          const prev = index > 0 ? filteredSortedStudents[index - 1] : null;
                          const showGradeSeparatorTop =
                            prev != null && prev.grade.trim() !== st.grade.trim();
                          return (
                            <StudentFeeRow
                              key={st.id}
                              student={st}
                              record={r}
                              underPaid={underPaid}
                              arrearsDue={arrearsDue}
                              totalDue={totalDue}
                              balanceCarryForward={balanceCarryForward}
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

                  {sideScrollHeight > sideScrollClientHeight ? (
                    <div className="border-l border-slate-200 bg-slate-50 px-2 py-2">
                      <div
                        ref={sideTrackRef}
                        role="scrollbar"
                        aria-label="Vertical scrollbar"
                        className="relative w-2.5 select-none rounded bg-white ring-1 ring-slate-200"
                        style={{ height: "calc(70vh - 16px)" }}
                        onMouseDown={onSideTrackMouseDown}
                      >
                        <div
                          className="absolute left-0 right-0 rounded bg-slate-400/80 hover:bg-slate-500"
                          style={{ height: sideThumb.size, transform: `translateY(${sideThumb.offset}px)` }}
                          onMouseDown={startDragSideThumb}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                {bottomScrollWidth > bottomScrollClientWidth ? (
                  <div className="border-t border-slate-200 bg-slate-50 px-4 py-2">
                    <div
                      ref={bottomTrackRef}
                      role="scrollbar"
                      aria-label="Horizontal scrollbar"
                      className="relative h-2.5 select-none rounded bg-white ring-1 ring-slate-200"
                      onMouseDown={onBottomTrackMouseDown}
                    >
                      <div
                        className="absolute bottom-0 top-0 rounded bg-slate-400/80 hover:bg-slate-500"
                        style={{ width: bottomThumb.size, transform: `translateX(${bottomThumb.offset}px)` }}
                        onMouseDown={startDragBottomThumb}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-sm font-bold text-amber-800">* Please confirm what L1-L9 each represent (for example: date / session / required sessions).</div>
                <div className="mt-2 text-sm text-amber-900">* After confirmation, I can connect these cells to the auto-calculation logic for lesson time and tuition.</div>
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
  sublabel?: string;
  columnKey: SortKey;
  sortConfig: SortConfig;
  setSortConfig: (config: SortConfig) => void;
  thClassName?: string;
  thStyle?: React.CSSProperties;
};

type StudentFeeRowProps = {
  student: StudentRow;
  record: RecordState;
  underPaid: boolean;
  arrearsDue: number;
  totalDue: number;
  balanceCarryForward: number;
  lessonDatesSerialized: string;
  remedialCount: number;
  /** Add a stronger top border when grade changes from previous row. */
  showGradeSeparatorTop: boolean;
  onSubmittedChange: (studentId: string, submitted: number) => void;
  onRemarksChange: (studentId: string, remarks: string) => void;
  onSendFeeChange: (studentId: string, sendFee: boolean) => void;
};

const StudentFeeRow = memo(function StudentFeeRow({
  student,
  record,
  underPaid,
  arrearsDue,
  totalDue,
  balanceCarryForward,
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
      <td
        className="sticky left-0 z-30 whitespace-nowrap bg-inherit px-4 py-4 text-sm text-slate-700"
        style={{ left: 0, minWidth: STICKY_ID_WIDTH }}
      >
        <Link
          href={`/students/${encodeURIComponent(studentIdDisplay)}/lessons`}
          className="font-medium text-[#1d76c2] hover:underline"
        >
          {studentIdDisplay}
        </Link>
      </td>
      <td
        className="sticky z-30 bg-inherit px-4 py-4 text-sm text-slate-700 align-top"
        style={{ left: STICKY_ID_WIDTH, minWidth: STICKY_NAME_WIDTH }}
      >
        <span
          className="inline-block whitespace-normal break-words leading-5 overflow-hidden [display:-webkit-box] [WebkitBoxOrient:vertical] [WebkitLineClamp:2]"
          title={formatStudentDisplayNameOrEmpty(
            {
              id: student.id,
              name_zh: student.name_zh,
              name_en: student.name_en,
              nickname_en: student.nickname_en,
            },
            "full",
          )}
        >
          {formatStudentDisplayNameOrEmpty(
            {
              id: student.id,
              name_zh: student.name_zh,
              name_en: student.name_en,
              nickname_en: student.nickname_en,
            },
            "full",
          )}
        </span>
      </td>
      <td
        className="sticky z-30 whitespace-nowrap border-r border-slate-200 bg-inherit px-4 py-4 text-sm text-slate-700"
        style={{ left: STICKY_ID_WIDTH + STICKY_NAME_WIDTH, minWidth: STICKY_GRADE_WIDTH }}
      >
        {formatGradeDisplay(student.grade) || "—"}
      </td>

      <td className="px-2 py-3 text-center">
        <div className="text-center text-xs font-medium text-slate-800" style={{ width: WEEKDAY_COL_WIDTH }}>
          {(record.weekday
            ? record.weekday
                .split("/")
                .map((wd) => HK_WEEKDAY_CN_TO_EN[wd] ?? wd)
                .join("/")
            : "") || "—"}
        </div>
      </td>
      <td className="px-2 py-3 text-center">
        <div
          className="text-center text-xs font-semibold text-slate-800 leading-4"
          style={{ width: TUITION_COL_WIDTH - 8 }}
          title={`Total Due ${totalDue} = Previous Balance ${arrearsDue} + This Month ${record.expected}`}
        >
          <div>{totalDue}</div>
          <div className="text-[10px] font-medium text-slate-500">
            Prev {arrearsDue} + This {record.expected}
          </div>
        </div>
      </td>
      <td className="px-2 py-3 text-center">
        <input
          type="number"
          inputMode="numeric"
          value={record.submitted}
          title={`Balance C/F: ${balanceCarryForward}`}
          onChange={(e) => {
            const num = Number(e.target.value);
            onSubmittedChange(student.id, Number.isFinite(num) ? num : 0);
          }}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
          style={{ width: TUITION_COL_WIDTH - 32 }}
        />
      </td>

      {Array.from({ length: L_COUNT }, (_, i) => (
        <td key={i} className="px-2 py-3 text-center">
          <div
            className="h-7 rounded bg-slate-50 px-1 text-center text-[11px] leading-6 text-slate-800"
            style={{ width: L_COL_WIDTH - 8 }}
          >
            {lessonDates[i] ?? ""}
          </div>
        </td>
      ))}

      <td className="px-2 py-3 text-center">
        <div className="text-center text-xs font-semibold text-slate-800" style={{ width: MAKEUP_COL_WIDTH - 32 }}>
          {remedialCount}
        </div>
      </td>

      <td className="px-2 py-3">
        <input
          type="text"
          value={record.remarks}
          onChange={(e) => onRemarksChange(student.id, e.target.value)}
          placeholder="Remarks"
          className="w-48 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
        />
      </td>

      <td className="px-2 py-3 text-center">
        <input
          type="checkbox"
          checked={record.sendFee}
          onChange={(e) => onSendFeeChange(student.id, e.target.checked)}
          className="h-4 w-4 accent-[#1d76c2]"
          aria-label={`${studentIdDisplay} send fee`}
        />
      </td>
    </tr>
  );
});

function SortableHeader({
  label,
  sublabel,
  columnKey,
  sortConfig,
  setSortConfig,
  thClassName,
  thStyle,
}: SortableHeaderProps) {
  const selectedDirection = sortConfig?.key === columnKey ? sortConfig.direction : "";

  return (
    <th
      style={thStyle}
      className={[
        "sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-4 py-3 text-left text-xs font-bold tracking-wider text-slate-700",
        thClassName ?? "",
      ].join(" ")}
    >
      <div className="flex items-start gap-1.5">
        <span className="leading-tight">
          <span className="block whitespace-nowrap">{label}</span>
          {sublabel ? <span className="block text-[10px] font-semibold text-slate-500">{sublabel}</span> : null}
        </span>
        <select
          aria-label={`Sort by ${label}`}
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

