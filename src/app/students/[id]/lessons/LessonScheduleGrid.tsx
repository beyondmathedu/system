"use client";

import { useEffect, useMemo, useState } from "react";
import {
  loadLessonScheduleRecords,
  saveLessonScheduleRecords,
} from "@/lib/studentLessonStorage";
import { readYmdParts } from "@/lib/intlFormatParts";

const WEEKDAY_OPTIONS = ["一", "二", "三", "四", "五", "六", "日"];
const ROOM_OPTIONS = ["B", "M前", "M後", "Hope", "Hope 2"];

const WEEKDAY_TIME_SUGGESTIONS = ["03:00 PM", "04:30 PM", "06:00 PM"];
const SATURDAY_TIME_SUGGESTIONS = [
  "10:00 AM",
  "11:30 AM",
  "01:00 PM",
  "02:30 PM",
];

function toHkIsoDateFromMs(ms: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));

  const { y, m, d } = readYmdParts(parts);
  return `${y}-${m}-${d}`;
}

function formatEffectiveDateZh(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(y, mo - 1, day);
  return dt.toLocaleDateString("zh-Hant", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

type ScheduleRecord = {
  id: string;
  effectiveDate?: string;
  weekday: string;
  time: string;
  room: string;
  tutor?: string;
  lessonSummary?: string;
  createdAt: number;
};

function normalizeLessonRecord(raw: ScheduleRecord): ScheduleRecord & { effectiveDate: string } {
  return {
    ...raw,
    effectiveDate: raw.effectiveDate ?? toHkIsoDateFromMs(raw.createdAt),
  };
}

export default function LessonScheduleGrid({ studentId }: { studentId: string }) {
  const [weekday, setWeekday] = useState("一");
  const [time, setTime] = useState("03:00 PM");
  const [customTime, setCustomTime] = useState("");
  const [room, setRoom] = useState("B");

  const RECORDS_STORAGE_KEY = `lesson_schedule_records:${studentId}`;
  const [records, setRecords] = useState<ScheduleRecord[]>([]);
  const [effectiveDate, setEffectiveDate] = useState("");

  const timeOptions = useMemo(() => {
    if (weekday === "六") return SATURDAY_TIME_SUGGESTIONS;
    if (weekday === "日") return [];
    return WEEKDAY_TIME_SUGGESTIONS;
  }, [weekday]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const cloudRecords = await loadLessonScheduleRecords(studentId);
        if (Array.isArray(cloudRecords) && cloudRecords.length > 0) {
          const normalized = (cloudRecords as ScheduleRecord[]).map(normalizeLessonRecord);
          setRecords(normalized);
          window.localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(normalized));
          return;
        }
        try {
          const raw = window.localStorage.getItem(RECORDS_STORAGE_KEY);
          if (!raw) return;
          const parsed = JSON.parse(raw) as ScheduleRecord[];
          if (Array.isArray(parsed)) {
            setRecords(parsed.map(normalizeLessonRecord));
          }
        } catch {
          // ignore corrupted storage
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [RECORDS_STORAGE_KEY]);

  useEffect(() => {
    if (effectiveDate) return;
    setEffectiveDate(toHkIsoDateFromMs(Date.now()));
  }, [effectiveDate]);

  const effectiveTime = useMemo(() => {
    if (weekday === "日") return customTime?.trim() ? customTime.trim() : "";
    const ct = customTime?.trim();
    if (ct) return ct;
    return time?.trim() ? time.trim() : "";
  }, [weekday, time, customTime]);

  const recordsSortedDesc = useMemo(
    () =>
      [...records].sort((a, b) => {
        const da = a.effectiveDate ?? "";
        const db = b.effectiveDate ?? "";
        const c = db.localeCompare(da);
        if (c !== 0) return c;
        return b.createdAt - a.createdAt;
      }),
    [records],
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="mb-4 text-sm text-slate-600">
        設定<strong className="font-semibold text-slate-800">生效日期</strong>
        後，自該日起往後會依你選的<strong className="font-semibold text-slate-800">
          星期、時間、Room
        </strong>
        ；再新增一筆（較晚生效）時，較早生效的<strong className="font-semibold text-slate-800">
          紀錄仍會保留
        </strong>
        ，不會被覆寫刪除。刪除請僅在按「刪除」時進行。
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">
            生效日期（自當日起適用）
          </span>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">星期</span>
          <select
            value={weekday}
            onChange={(e) => {
              const nextWeekday = e.target.value;
              setWeekday(nextWeekday);
              if (nextWeekday === "六") setTime("10:00 AM");
              else if (nextWeekday === "日") {
                setTime("");
                setCustomTime("");
              }
              else setTime("03:00 PM");
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          >
            {WEEKDAY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                星期{option}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">時間</span>
          {weekday === "日" ? (
            <input
              type="text"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              placeholder="自由輸入，例如：下午5:15"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
            />
          ) : (
            <div className="space-y-2">
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
              >
                {timeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                placeholder="自由輸入（可留空）"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
              />
            </div>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">Room</span>
          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          >
            {ROOM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-bold text-slate-900">目前設定</p>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-600">星期</span>
              <span className="font-bold text-slate-900">星期{weekday}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-600">時間</span>
              <span className="font-bold text-slate-900">{time || "-"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-600">自由輸入（可留空）</span>
              <span className="font-bold text-slate-900">
                {customTime?.trim() ? customTime : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-600">Room</span>
              <span className="font-bold text-slate-900">{room}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-900">你的選擇記錄</p>
            <button
              type="button"
              onClick={() => {
                const nextTime = effectiveTime;
                if (!nextTime) return;
                if (!effectiveDate.trim()) return;

                const next: ScheduleRecord = {
                  id: `${Date.now()}`,
                  effectiveDate: effectiveDate.trim(),
                  weekday,
                  time: nextTime,
                  room,
                  createdAt: Date.now(),
                };

                const merged = [...records, next].map(normalizeLessonRecord);
                setRecords(merged);
                window.localStorage.setItem(
                  RECORDS_STORAGE_KEY,
                  JSON.stringify(merged),
                );
                void saveLessonScheduleRecords(studentId, merged);
              }}
              className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
            >
              加入記錄
            </button>
          </div>

          <div className="mt-3 overflow-x-auto">
            {records.length === 0 ? (
              <p className="text-xs text-slate-500">
                尚未有記錄，請選擇生效日期並完成星期／時間／Room，再按「加入記錄」。
              </p>
            ) : (
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="divide-x divide-slate-200 border-b border-slate-200 bg-slate-50 text-left text-xs font-bold text-slate-700">
                    <th className="whitespace-nowrap px-3 py-2">生效日期（月/日）</th>
                    <th className="whitespace-nowrap px-3 py-2">星期</th>
                    <th className="whitespace-nowrap px-3 py-2">時間</th>
                    <th className="whitespace-nowrap px-3 py-2">Room</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {recordsSortedDesc.map((r) => (
                    <tr key={r.id} className="divide-x divide-slate-100 border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-800">
                        {formatEffectiveDateZh(r.effectiveDate ?? "")}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">星期{r.weekday}</td>
                      <td className="px-3 py-2 text-slate-800">{r.time}</td>
                      <td className="px-3 py-2 text-slate-800">{r.room}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEffectiveDate(r.effectiveDate ?? "");
                              setWeekday(r.weekday);
                              const isSun = r.weekday === "日";
                              if (isSun) {
                                setTime("");
                                setCustomTime(r.time);
                              } else {
                                setTime(r.time);
                                setCustomTime("");
                              }
                              setRoom(r.room);
                            }}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            帶入表單
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  "確定要刪除此筆生效記錄？\n刪除後若沒有其他較早／較完整的時段紀錄，2026 課表上較早月份可能會跟著改變。",
                                )
                              ) {
                                return;
                              }
                              const next = records.filter((rec) => rec.id !== r.id);
                              setRecords(next);
                              window.localStorage.setItem(
                                RECORDS_STORAGE_KEY,
                                JSON.stringify(next),
                              );
                              void saveLessonScheduleRecords(studentId, next);
                            }}
                            className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                          >
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

