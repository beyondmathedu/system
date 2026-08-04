"use client";

import { useEffect, useMemo, useState } from "react";
import ClientOnlyAfterMount from "@/components/ClientOnlyAfterMount";
import ScheduleDuplicateRulesBanner from "@/components/ScheduleDuplicateRulesBanner";
import { hasDuplicateScheduleSlotInVersion } from "@/lib/lessonScheduleVersions";
import {
  loadLessonScheduleRecords,
} from "@/lib/studentLessonStorage";
import { queueSaveLessonScheduleRecords } from "@/lib/queueSaveLessonScheduleRecords";
import { readYmdParts } from "@/lib/intlFormatParts";
import {
  ROOM_GROUPS,
  canonicalScheduleRoomLabel,
  resolveScheduleRoomPickerValue,
  scheduleRoomsMatch,
} from "@/lib/dayTimetableShared";
import { useRoomDisplayLabels } from "@/lib/useRoomDisplayRegistry";

function LessonScheduleGridFallback() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-14 rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="h-9 w-28 rounded-md bg-slate-200" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="h-40 rounded-xl bg-slate-50" />
        <div className="h-56 rounded-xl bg-slate-50" />
      </div>
    </div>
  );
}

const WEEKDAY_OPTIONS = ["一", "二", "三", "四", "五", "六", "日"];
const ROOM_OPTIONS = [...ROOM_GROUPS];
const WEEKDAY_LABEL: Record<string, string> = {
  一: "Mon",
  二: "Tue",
  三: "Wed",
  四: "Thu",
  五: "Fri",
  六: "Sat",
  日: "Sun",
};

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
  return dt.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type LessonScheduleRecord = {
  id: string;
  effectiveDate?: string;
  weekday: string;
  time: string;
  room: string;
  tutor?: string;
  lessonSummary?: string;
  createdAt: number;
};

type ScheduleRecord = LessonScheduleRecord;

function normalizeLessonRecord(raw: ScheduleRecord): ScheduleRecord & { effectiveDate: string } {
  return {
    ...raw,
    // Keep schedule JSON on canonical keys (Hope / Hope 2), not display names.
    room: canonicalScheduleRoomLabel(raw.room ?? ""),
    effectiveDate: raw.effectiveDate ?? toHkIsoDateFromMs(raw.createdAt),
  };
}

export default function LessonScheduleGrid({
  studentId,
  initialRecords,
  onRecordsChange,
}: {
  studentId: string;
  initialRecords?: LessonScheduleRecord[] | null;
  onRecordsChange?: (records: LessonScheduleRecord[]) => void;
}) {
  const { formatRoom, pickerLabel, pickerToStorage, registry } = useRoomDisplayLabels();
  const [weeklyLessons, setWeeklyLessons] = useState<1 | 2>(1);
  const [weekday, setWeekday] = useState("一");
  const [time, setTime] = useState("03:00 PM");
  const [customTime, setCustomTime] = useState("");
  const [room, setRoom] = useState("B");
  const [weekday2, setWeekday2] = useState("三");
  const [time2, setTime2] = useState("03:00 PM");
  const [customTime2, setCustomTime2] = useState("");
  const [room2, setRoom2] = useState("B");

  const RECORDS_STORAGE_KEY = `lesson_schedule_records:${studentId}`;
  const recordsBootstrapKey =
    initialRecords != null ? `props:${studentId}:${initialRecords.length}` : `fetch:${studentId}`;
  const [recordsBootstrap, setRecordsBootstrap] = useState(recordsBootstrapKey);
  const [records, setRecords] = useState<ScheduleRecord[]>(() =>
    initialRecords?.map(normalizeLessonRecord) ?? [],
  );
  const [effectiveDate, setEffectiveDate] = useState(() => toHkIsoDateFromMs(Date.now()));
  const [filterEffectiveDate, setFilterEffectiveDate] = useState("");
  const [filterWeekday, setFilterWeekday] = useState("");
  const [filterTime, setFilterTime] = useState("");
  const [filterRoom, setFilterRoom] = useState("");
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [saveSlotError, setSaveSlotError] = useState("");
  const [laterVersionRoomHint, setLaterVersionRoomHint] = useState("");

  const timeOptions = useMemo(() => {
    if (weekday === "六") return SATURDAY_TIME_SUGGESTIONS;
    if (weekday === "日") return [];
    return WEEKDAY_TIME_SUGGESTIONS;
  }, [weekday]);
  const timeOptions2 = useMemo(() => {
    if (weekday2 === "六") return SATURDAY_TIME_SUGGESTIONS;
    if (weekday2 === "日") return [];
    return WEEKDAY_TIME_SUGGESTIONS;
  }, [weekday2]);

  if (recordsBootstrapKey !== recordsBootstrap) {
    setRecordsBootstrap(recordsBootstrapKey);
    if (initialRecords != null) {
      const normalized = initialRecords.map(normalizeLessonRecord);
      setRecords(normalized);
      window.localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(normalized));
    } else {
      setRecords([]);
    }
  }

  useEffect(() => {
    if (initialRecords != null) return;
    let cancelled = false;
    void (async () => {
      const cloudRecords = await loadLessonScheduleRecords(studentId);
      if (cancelled) return;
      if (Array.isArray(cloudRecords) && cloudRecords.length > 0) {
        const normalized = (cloudRecords as ScheduleRecord[]).map(normalizeLessonRecord);
        setRecords(normalized);
        window.localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(normalized));
        const needsCanonicalRewrite = (cloudRecords as ScheduleRecord[]).some(
          (r, i) => (r.room ?? "").trim() !== normalized[i].room,
        );
        if (needsCanonicalRewrite) {
          queueSaveLessonScheduleRecords(studentId, normalized);
          onRecordsChange?.(normalized);
        }
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
    return () => {
      cancelled = true;
    };
  }, [RECORDS_STORAGE_KEY, studentId, initialRecords, onRecordsChange]);

  const effectiveTime = useMemo(() => {
    if (weekday === "日") return customTime?.trim() ? customTime.trim() : "";
    const ct = customTime?.trim();
    if (ct) return ct;
    return time?.trim() ? time.trim() : "";
  }, [weekday, time, customTime]);
  const effectiveTime2 = useMemo(() => {
    if (weekday2 === "日") return customTime2?.trim() ? customTime2.trim() : "";
    const ct = customTime2?.trim();
    if (ct) return ct;
    return time2?.trim() ? time2.trim() : "";
  }, [weekday2, time2, customTime2]);

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
  const roomFilterOptions = useMemo(() => {
    const set = new Set<string>(ROOM_OPTIONS);
    for (const r of records) {
      const canonical = canonicalScheduleRoomLabel(r.room ?? "");
      if (canonical) set.add(canonical);
    }
    return Array.from(set);
  }, [records]);
  const filteredRecordsSortedDesc = useMemo(() => {
    return recordsSortedDesc.filter((r) => {
      const normalized = normalizeLessonRecord(r);
      if (filterEffectiveDate && normalized.effectiveDate !== filterEffectiveDate) return false;
      if (filterWeekday && normalized.weekday !== filterWeekday) return false;
      if (filterTime.trim() && !normalized.time.toLowerCase().includes(filterTime.trim().toLowerCase())) {
        return false;
      }
      if (filterRoom && !scheduleRoomsMatch(normalized.room, filterRoom, registry)) return false;
      return true;
    });
  }, [recordsSortedDesc, filterEffectiveDate, filterWeekday, filterTime, filterRoom, registry]);

  function loadRecordIntoForm(r: ScheduleRecord) {
    setEditingRecordId(r.id);
    setWeeklyLessons(1);
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
    setRoom(resolveScheduleRoomPickerValue(r.room, ROOM_GROUPS[0], registry));
  }

  function clearEditMode() {
    setEditingRecordId(null);
    setLaterVersionRoomHint("");
  }

  const persistRecords = (next: ScheduleRecord[]) => {
    const normalized = next.map(normalizeLessonRecord);
    setRecords(normalized);
    window.localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(normalized));
    onRecordsChange?.(normalized);
    queueSaveLessonScheduleRecords(studentId, normalized);
  };

  function laterVersionRoomConflicts(
    candidate: { id?: string; effectiveDate: string; weekday: string; time: string; room: string },
  ): Array<ScheduleRecord & { effectiveDate: string }> {
    return records
      .map(normalizeLessonRecord)
      .filter(
        (r) =>
          r.id !== candidate.id &&
          r.weekday === candidate.weekday &&
          r.time === candidate.time &&
          r.effectiveDate > candidate.effectiveDate &&
          !scheduleRoomsMatch(r.room, candidate.room, registry),
      );
  }

  const handleSaveRecord = () => {
    const nextTime = effectiveTime;
    if (!nextTime) return;
    if (!effectiveDate.trim()) return;
    setSaveSlotError("");
    setLaterVersionRoomHint("");

    if (editingRecordId) {
      const existing = records.find((rec) => rec.id === editingRecordId);
      if (!existing) {
        clearEditMode();
        return;
      }
      const updated: ScheduleRecord = {
        ...existing,
        effectiveDate: effectiveDate.trim(),
        weekday,
        time: nextTime,
        room: pickerToStorage(room),
      };
      if (
        hasDuplicateScheduleSlotInVersion(
          records.map(normalizeLessonRecord),
          normalizeLessonRecord(updated),
          editingRecordId,
        )
      ) {
        setSaveSlotError("此生效日已有相同星期、時間、房間的課表，請改時間或房間，或使用下方「合併重複」。");
        return;
      }
      const conflicts = laterVersionRoomConflicts(normalizeLessonRecord(updated));
      const merged = records.map((rec) => (rec.id === editingRecordId ? updated : rec));
      persistRecords(merged);
      clearEditMode();
      if (conflicts.length > 0) {
        const latest = [...conflicts].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
        setLaterVersionRoomHint(
          `已儲存。注意：較晚的生效日 ${formatEffectiveDateZh(latest.effectiveDate)} 仍是 ${formatRoom(latest.room)}；之後課堂會用那一版，不是這筆。若要改成 ${formatRoom(updated.room)}，請一併 Edit 那筆記錄。`,
        );
      }
      return;
    }

    const nextTime2 = effectiveTime2;
    if (weeklyLessons === 2 && !nextTime2) return;

    const ed = effectiveDate.trim();
    const normalized = records.map(normalizeLessonRecord);
    const storedRoom = pickerToStorage(room);
    const storedRoom2 = pickerToStorage(room2);
    if (hasDuplicateScheduleSlotInVersion(normalized, { effectiveDate: ed, weekday, time: nextTime, room: storedRoom })) {
      setSaveSlotError("此生效日已有相同星期、時間、房間的課表。請勿重複新增，或先合併下方重複項。");
      return;
    }
    if (
      weeklyLessons === 2 &&
      hasDuplicateScheduleSlotInVersion(normalized, {
        effectiveDate: ed,
        weekday: weekday2,
        time: nextTime2,
        room: storedRoom2,
      })
    ) {
      setSaveSlotError("第二堂與現有課表時段重複。");
      return;
    }

    const now = Date.now();
    const newRecords: ScheduleRecord[] = [
      {
        id: `${now}-1`,
        effectiveDate: ed,
        weekday,
        time: nextTime,
        room: storedRoom,
        createdAt: now,
      },
    ];
    if (weeklyLessons === 2) {
      newRecords.push({
        id: `${now}-2`,
        effectiveDate: ed,
        weekday: weekday2,
        time: nextTime2,
        room: storedRoom2,
        createdAt: now + 1,
      });
    }

    persistRecords([...records, ...newRecords]);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="mb-4 text-sm text-slate-600">
        Set an <strong className="font-semibold text-slate-800">effective date</strong>. From that date onward, lessons follow the selected
        <strong className="font-semibold text-slate-800"> day, time, and room</strong>. When you add a later effective record, earlier records are
        <strong className="font-semibold text-slate-800"> kept</strong> (not overwritten). Use <strong className="font-semibold text-slate-800">Delete</strong> only when needed.
      </p>
      <ScheduleDuplicateRulesBanner
        records={records.map(normalizeLessonRecord)}
        weekdayLabel={(wd) => WEEKDAY_LABEL[wd] ?? wd}
        formatRoom={formatRoom}
        onMerged={(next) => {
          persistRecords(next as ScheduleRecord[]);
          setSaveSlotError("");
        }}
      />
      {saveSlotError ? (
        <p className="mb-3 text-xs font-medium text-red-600">{saveSlotError}</p>
      ) : null}
      {laterVersionRoomHint ? (
        <p className="mb-3 text-xs font-medium text-amber-800">{laterVersionRoomHint}</p>
      ) : null}
      <ClientOnlyAfterMount fallback={<LessonScheduleGridFallback />}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-8">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-700">Weekly Lessons</span>
          <select
            value={weeklyLessons}
            onChange={(e) => setWeeklyLessons(e.target.value === "2" ? 2 : 1)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          >
            <option value={1}>1 Lesson</option>
            <option value={2}>2 Lessons</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-700">Effective Date</span>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-700">Lesson 1 Day</span>
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
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          >
            {WEEKDAY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {WEEKDAY_LABEL[option] ?? option}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-700">Lesson 1 Time</span>
          {weekday === "日" ? (
            <input
              type="text"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              placeholder="Custom input"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
            />
          ) : (
            <div className="space-y-1.5">
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
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
                placeholder="Custom input"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
              />
            </div>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-700">Lesson 1 Room</span>
          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          >
            {ROOM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {pickerLabel(option)}
              </option>
            ))}
          </select>
        </label>
        {weeklyLessons === 2 ? (
          <>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">Lesson 2 Day</span>
            <select
              value={weekday2}
              onChange={(e) => {
                const nextWeekday = e.target.value;
                setWeekday2(nextWeekday);
                if (nextWeekday === "六") setTime2("10:00 AM");
                else if (nextWeekday === "日") {
                  setTime2("");
                  setCustomTime2("");
                } else setTime2("03:00 PM");
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
            >
              {WEEKDAY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {WEEKDAY_LABEL[option] ?? option}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">Lesson 2 Time</span>
            {weekday2 === "日" ? (
              <input
                type="text"
                value={customTime2}
                onChange={(e) => setCustomTime2(e.target.value)}
                placeholder="Custom input"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
              />
            ) : (
              <div className="space-y-1.5">
                <select
                  value={time2}
                  onChange={(e) => setTime2(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                >
                  {timeOptions2.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={customTime2}
                  onChange={(e) => setCustomTime2(e.target.value)}
                  placeholder="Custom input"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                />
              </div>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">Lesson 2 Room</span>
            <select
              value={room2}
              onChange={(e) => setRoom2(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
            >
              {ROOM_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {pickerLabel(option)}
                </option>
              ))}
            </select>
          </label>
          </>
        ) : null}
      </div>
      {editingRecordId ? (
        <p className="mt-3 rounded-lg border border-[#1d76c2]/30 bg-[#1d76c2]/5 px-3 py-2 text-xs text-slate-700">
          正在編輯已儲存紀錄；修改後按 <strong className="font-semibold text-slate-900">Save</strong> 會直接更新該筆（不會新增一筆）。
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        {editingRecordId ? (
          <button
            type="button"
            onClick={clearEditMode}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleSaveRecord}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" />
          </svg>
          {editingRecordId ? "Save" : "Add Record"}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-bold text-slate-900">Current Settings</p>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Weekly Lessons:</span>
              <span className="font-bold text-slate-900">{weeklyLessons}</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs font-bold text-slate-500">Lesson 1</p>
              <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-slate-600">Day</span>
                <span className="font-bold text-slate-900">{WEEKDAY_LABEL[weekday] ?? weekday}</span>
                <span className="font-semibold text-slate-600">Time</span>
                <span className="font-bold text-slate-900">{effectiveTime || "—"}</span>
                <span className="font-semibold text-slate-600">Room</span>
                <span className="font-bold text-slate-900">{room ? pickerLabel(resolveScheduleRoomPickerValue(room, ROOM_GROUPS[0], registry)) : "—"}</span>
              </div>
            </div>
            {weeklyLessons === 2 ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs font-bold text-slate-500">Lesson 2</p>
                <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold text-slate-600">Day</span>
                  <span className="font-bold text-slate-900">{WEEKDAY_LABEL[weekday2] ?? weekday2}</span>
                  <span className="font-semibold text-slate-600">Time</span>
                  <span className="font-bold text-slate-900">{effectiveTime2 || "—"}</span>
                  <span className="font-semibold text-slate-600">Room</span>
                  <span className="font-bold text-slate-900">{room2 ? pickerLabel(resolveScheduleRoomPickerValue(room2, ROOM_GROUPS[0], registry)) : "—"}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-900">Your Saved Records</p>
          </div>

          <div className="mt-3 overflow-x-auto">
            <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">Effective Date (D/M)</span>
                <input
                  type="date"
                  value={filterEffectiveDate}
                  onChange={(e) => setFilterEffectiveDate(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">Day</span>
                <select
                  value={filterWeekday}
                  onChange={(e) => setFilterWeekday(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
                >
                  <option value="">All</option>
                  {WEEKDAY_OPTIONS.map((wd) => (
                    <option key={wd} value={wd}>
                      {WEEKDAY_LABEL[wd] ?? wd}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">Time</span>
                <input
                  type="text"
                  value={filterTime}
                  onChange={(e) => setFilterTime(e.target.value)}
                  placeholder="e.g. 03:00 PM"
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">Room</span>
                <select
                  value={filterRoom}
                  onChange={(e) => setFilterRoom(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none transition focus:border-[#1d76c2]"
                >
                  <option value="">All</option>
                  {roomFilterOptions.map((rm) => (
                    <option key={rm} value={rm}>
                      {formatRoom(rm)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {records.length === 0 ? (
              <p className="text-xs text-slate-500">
                No records yet. Choose effective date, day, time, and room, then click &quot;Add Record&quot;.
              </p>
            ) : filteredRecordsSortedDesc.length === 0 ? (
              <p className="text-xs text-slate-500">
                No records match current filters.
              </p>
            ) : (
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="divide-x divide-slate-200 border-b border-slate-200 bg-slate-50 text-left text-xs font-bold text-slate-700">
                    <th className="whitespace-nowrap px-3 py-2">Effective Date (D/M)</th>
                    <th className="whitespace-nowrap px-3 py-2">Day</th>
                    <th className="whitespace-nowrap px-3 py-2">Time</th>
                    <th className="whitespace-nowrap px-3 py-2">Room</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecordsSortedDesc.map((r) => (
                    <tr
                      key={r.id}
                      className={`divide-x divide-slate-100 border-b border-slate-100 ${
                        editingRecordId === r.id ? "bg-[#1d76c2]/5" : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-slate-800">
                        {formatEffectiveDateZh(r.effectiveDate ?? "")}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">{WEEKDAY_LABEL[r.weekday] ?? r.weekday}</td>
                      <td className="px-3 py-2 text-slate-800">{r.time}</td>
                      <td className="px-3 py-2 text-slate-800">{formatRoom(r.room)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => loadRecordIntoForm(r)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.793 8.793-2.12.53.53-2.12 8.793-8.793zm1.414-1.414a4 4 0 00-5.656 0l-9.192 9.193a1 1 0 00-.263.464l-1 4a1 1 0 001.213 1.213l4-1a1 1 0 00.464-.263l9.193-9.192a4 4 0 000-5.657z" />
                            </svg>
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  "Delete this effective record?\nDays before its effective date will no longer use this rule; later days may fall back to an earlier rule if one exists.",
                                )
                              ) {
                                return;
                              }
                              if (editingRecordId === r.id) clearEditMode();
                              persistRecords(records.filter((rec) => rec.id !== r.id));
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                          >
                            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                              <path d="M7.5 2.75A1.75 1.75 0 005.75 4.5v.25H4a.75.75 0 000 1.5h.5l.73 9.1A2 2 0 007.22 17.2h5.56a2 2 0 001.99-1.85l.73-9.1H16a.75.75 0 000-1.5h-1.75V4.5A1.75 1.75 0 0012.5 2.75h-5zM12.75 4.5v.25h-5.5V4.5a.25.25 0 01.25-.25h5a.25.25 0 01.25.25z" />
                            </svg>
                            Delete
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
      </ClientOnlyAfterMount>
    </div>
  );
}

