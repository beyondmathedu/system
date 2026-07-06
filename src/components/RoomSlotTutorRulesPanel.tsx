"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ROOM_GROUPS } from "@/lib/dayTimetableShared";
import { notifyScheduleCachesStale } from "@/lib/scheduleCacheClient";
import { supabase } from "@/lib/supabase";
import {
  deleteRoomSlotTutorRule,
  normalizeRoomSlotRuleRow,
  ROOM_SLOT_WEEKDAY_OPTIONS,
  type RoomSlotTutorRule,
  timeSuggestionsForScheduleWeekday,
  upsertRoomSlotTutorRule,
  WEEKDAY_SLOT_TIME_SUGGESTIONS,
} from "@/lib/roomSlotTutorRules";

const WEEKDAY_LABEL: Record<string, string> = {
  一: "Mon",
  二: "Tue",
  三: "Wed",
  四: "Thu",
  五: "Fri",
  六: "Sat",
  日: "Sun",
};

function todayIsoLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type Props = {
  tutorOptions: string[];
};

export default function RoomSlotTutorRulesPanel({ tutorOptions }: Props) {
  const [rules, setRules] = useState<RoomSlotTutorRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [room, setRoom] = useState<string>(ROOM_GROUPS[0]);
  const [weekday, setWeekday] = useState<string>("一");
  const [time, setTime] = useState<string>(WEEKDAY_SLOT_TIME_SUGGESTIONS[0]);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [slotTutor, setSlotTutor] = useState("");

  useEffect(() => {
    setEffectiveDate(todayIsoLocal());
  }, []);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadErr } = await supabase
      .from("room_slot_tutor_rules")
      .select("id, room, weekday, time, tutor_name, effective_date")
      .order("room")
      .order("weekday")
      .order("time")
      .order("effective_date", { ascending: false });
    if (loadErr) {
      if (/room_slot_tutor_rules/i.test(loadErr.message) && /does not exist/i.test(loadErr.message)) {
        setRules([]);
        setError("請在 Supabase 執行 migration：20260707_room_slot_tutor_rules.sql");
      } else {
        setError(loadErr.message);
      }
      setLoading(false);
      return;
    }
    const mapped: RoomSlotTutorRule[] = [];
    for (const row of data ?? []) {
      const normalized = normalizeRoomSlotRuleRow(row as Record<string, unknown>);
      if (normalized) mapped.push(normalized);
    }
    setRules(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const sortedRules = useMemo(() => {
    return [...rules].sort((a, b) => {
      const roomCmp = a.room.localeCompare(b.room, "zh-Hant");
      if (roomCmp !== 0) return roomCmp;
      const wd =
        ROOM_SLOT_WEEKDAY_OPTIONS.indexOf(a.weekday as (typeof ROOM_SLOT_WEEKDAY_OPTIONS)[number]) -
        ROOM_SLOT_WEEKDAY_OPTIONS.indexOf(b.weekday as (typeof ROOM_SLOT_WEEKDAY_OPTIONS)[number]);
      if (wd !== 0) return wd;
      const timeCmp = a.time.localeCompare(b.time, "en", { numeric: true });
      if (timeCmp !== 0) return timeCmp;
      return b.effective_date.localeCompare(a.effective_date);
    });
  }, [rules]);

  const timeOptions = useMemo(() => [...timeSuggestionsForScheduleWeekday(weekday)], [weekday]);

  const currentSlotRule = useMemo(() => {
    if (!effectiveDate) return null;
    return (
      rules.find(
        (rule) =>
          rule.room === room &&
          rule.weekday === weekday &&
          rule.time === time &&
          rule.effective_date === effectiveDate,
      ) ?? null
    );
  }, [rules, room, weekday, time, effectiveDate]);

  useEffect(() => {
    setSlotTutor(currentSlotRule?.tutor_name ?? "");
  }, [currentSlotRule?.id, currentSlotRule?.tutor_name]);

  async function saveTutorForSlot(input: {
    room: string;
    weekday: string;
    time: string;
    tutor_name: string;
    effective_date: string;
    savingKey: string;
  }): Promise<boolean> {
    if (!input.tutor_name.trim() || !input.effective_date.trim()) return false;
    setSavingKey(input.savingKey);
    setError("");
    try {
      await upsertRoomSlotTutorRule(supabase, {
        room: input.room,
        weekday: input.weekday,
        time: input.time,
        tutor_name: input.tutor_name.trim(),
        effective_date: input.effective_date.trim(),
      });
      notifyScheduleCachesStale();
      await loadRules();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSavingKey(null);
    }
  }

  async function handleAdd() {
    if (!slotTutor.trim() || !effectiveDate) return;
    await saveTutorForSlot({
      room,
      weekday,
      time,
      tutor_name: slotTutor,
      effective_date: effectiveDate,
      savingKey: `quick:${room}:${weekday}:${time}:${effectiveDate}`,
    });
  }

  async function handleRowTutorChange(rule: RoomSlotTutorRule, nextTutor: string) {
    if (!nextTutor.trim() || nextTutor === rule.tutor_name) return;
    await saveTutorForSlot({
      room: rule.room,
      weekday: rule.weekday,
      time: rule.time,
      tutor_name: nextTutor,
      effective_date: rule.effective_date,
      savingKey: rule.id,
    });
  }

  async function handleDelete(id: string) {
    setSavingKey(id);
    setError("");
    try {
      await deleteRoomSlotTutorRule(supabase, id);
      notifyScheduleCachesStale();
      await loadRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSavingKey(null);
    }
  }

  const quickSaving = savingKey === `quick:${room}:${weekday}:${time}:${effectiveDate}`;

  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
      <h2 className="text-lg font-bold text-slate-900">Room slot tutors（長期預設）</h2>
      <p className="mt-1 text-sm text-slate-600">
        平日（一至五）與星期六的上課時間不同；選星期後 Time 會自動對應。選好後按 Add 儲存。單日代课請在 Room
        頁改導師。
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Room</span>
          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {ROOM_GROUPS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Weekday</span>
          <select
            value={weekday}
            onChange={(e) => {
              const nextWeekday = e.target.value;
              setWeekday(nextWeekday);
              const nextTimes = timeSuggestionsForScheduleWeekday(nextWeekday);
              setTime(nextTimes[0] ?? "");
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {ROOM_SLOT_WEEKDAY_OPTIONS.map((wd) => (
              <option key={wd} value={wd}>
                {WEEKDAY_LABEL[wd] ?? wd}（{wd}）
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Time</span>
          <select
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={timeOptions.length === 0}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-60"
          >
            {timeOptions.length === 0 ? (
              <option value="">— 無恆常課 —</option>
            ) : (
              timeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Effective from</span>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            suppressHydrationWarning
          />
        </label>
        <label className="block min-w-[140px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Tutor</span>
          <select
            value={slotTutor}
            onChange={(e) => setSlotTutor(e.target.value)}
            disabled={quickSaving || !effectiveDate}
            className="w-full min-w-[140px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            <option value="">— 選導師 —</option>
            {tutorOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={quickSaving || !slotTutor.trim() || !effectiveDate || !time.trim()}
          onClick={() => void handleAdd()}
          className="rounded-md bg-[#1d76c2] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {quickSaving ? "Saving…" : "Add"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2">Room</th>
              <th className="px-3 py-2">Weekday</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Tutor</th>
              <th className="px-3 py-2">Effective</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : sortedRules.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  尚未設定；請在上方選時段與導師後按 Add
                </td>
              </tr>
            ) : (
              sortedRules.map((rule) => (
                <tr key={rule.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{rule.room}</td>
                  <td className="px-3 py-2">
                    {WEEKDAY_LABEL[rule.weekday] ?? rule.weekday}（{rule.weekday}）
                  </td>
                  <td className="px-3 py-2">{rule.time}</td>
                  <td className="px-3 py-2">
                    <select
                      value={rule.tutor_name}
                      onChange={(e) => void handleRowTutorChange(rule, e.target.value)}
                      disabled={savingKey === rule.id}
                      className="min-w-[120px] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium disabled:opacity-60"
                    >
                      {tutorOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{rule.effective_date}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={savingKey === rule.id}
                      onClick={() => void handleDelete(rule.id)}
                      className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
