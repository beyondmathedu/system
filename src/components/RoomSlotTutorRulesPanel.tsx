"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
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

type SortDirection = "asc" | "desc";
type SlotRulesSortKey = "weekday" | "time" | "room" | "tutor" | "effective";
type SlotRulesSortConfig = { key: SlotRulesSortKey; direction: SortDirection } | null;

const STICKY_WEEKDAY_WIDTH = 108;
const STICKY_TIME_WIDTH = 104;
const STICKY_ROOM_WIDTH = 72;
const STICKY_TIME_LEFT = STICKY_WEEKDAY_WIDTH;
const STICKY_ROOM_LEFT = STICKY_WEEKDAY_WIDTH + STICKY_TIME_WIDTH;

function weekdaySortIndex(weekday: string): number {
  const i = ROOM_SLOT_WEEKDAY_OPTIONS.indexOf(weekday as (typeof ROOM_SLOT_WEEKDAY_OPTIONS)[number]);
  return i >= 0 ? i : 999;
}

function timeSortMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(time ?? "").trim());
  if (!m) return 9999;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const isPm = m[3].toUpperCase() === "PM";
  if (isPm && hour !== 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function roomSortIndex(room: string): number {
  const i = ROOM_GROUPS.indexOf(room as (typeof ROOM_GROUPS)[number]);
  return i >= 0 ? i : 999;
}

function compareRulesDefault(a: RoomSlotTutorRule, b: RoomSlotTutorRule): number {
  const wd = weekdaySortIndex(a.weekday) - weekdaySortIndex(b.weekday);
  if (wd !== 0) return wd;
  const timeCmp = timeSortMinutes(a.time) - timeSortMinutes(b.time);
  if (timeCmp !== 0) return timeCmp;
  const roomCmp = roomSortIndex(a.room) - roomSortIndex(b.room);
  if (roomCmp !== 0) return roomCmp;
  return b.effective_date.localeCompare(a.effective_date);
}

function compareRulesByConfig(
  a: RoomSlotTutorRule,
  b: RoomSlotTutorRule,
  sortConfig: SlotRulesSortConfig,
): number {
  if (!sortConfig) return compareRulesDefault(a, b);

  const { key, direction } = sortConfig;
  const multiplier = direction === "asc" ? 1 : -1;
  let primary = 0;

  switch (key) {
    case "weekday":
      primary = weekdaySortIndex(a.weekday) - weekdaySortIndex(b.weekday);
      break;
    case "time":
      primary = timeSortMinutes(a.time) - timeSortMinutes(b.time);
      break;
    case "room":
      primary = roomSortIndex(a.room) - roomSortIndex(b.room);
      break;
    case "tutor":
      primary = a.tutor_name.localeCompare(b.tutor_name, "zh-Hant");
      break;
    case "effective":
      primary = a.effective_date.localeCompare(b.effective_date);
      break;
    default:
      primary = 0;
  }

  if (primary !== 0) return primary * multiplier;
  return compareRulesDefault(a, b);
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
  const [sortConfig, setSortConfig] = useState<SlotRulesSortConfig>(null);

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
    return [...rules].sort((a, b) => compareRulesByConfig(a, b, sortConfig));
  }, [rules, sortConfig]);

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
        平日（一至五）與星期六的上課時間不同；選好後按 Add 儲存。列表預設按「星期 → 時間 → 房間」排列，表頭可排序，左三欄凍結。
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

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="max-h-[50vh] overflow-auto">
          <table className="min-w-[760px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                <SlotRulesSortableHeader
                  label="Weekday"
                  columnKey="weekday"
                  sortConfig={sortConfig}
                  setSortConfig={setSortConfig}
                  thClassName="left-0 z-40"
                  thStyle={{ left: 0, minWidth: STICKY_WEEKDAY_WIDTH }}
                />
                <SlotRulesSortableHeader
                  label="Time"
                  columnKey="time"
                  sortConfig={sortConfig}
                  setSortConfig={setSortConfig}
                  thClassName="z-40"
                  thStyle={{ left: STICKY_TIME_LEFT, minWidth: STICKY_TIME_WIDTH }}
                />
                <SlotRulesSortableHeader
                  label="Room"
                  columnKey="room"
                  sortConfig={sortConfig}
                  setSortConfig={setSortConfig}
                  thClassName="z-40 border-r border-slate-200"
                  thStyle={{ left: STICKY_ROOM_LEFT, minWidth: STICKY_ROOM_WIDTH }}
                />
                <SlotRulesSortableHeader
                  label="Tutor"
                  columnKey="tutor"
                  sortConfig={sortConfig}
                  setSortConfig={setSortConfig}
                />
                <SlotRulesSortableHeader
                  label="Effective"
                  columnKey="effective"
                  sortConfig={sortConfig}
                  setSortConfig={setSortConfig}
                />
                <th className="sticky top-0 z-20 whitespace-nowrap bg-slate-100 px-3 py-2" />
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
                sortedRules.map((rule, index) => {
                  const prevWeekday = index > 0 ? sortedRules[index - 1]?.weekday : null;
                  const isNewWeekdayGroup = prevWeekday != null && prevWeekday !== rule.weekday;

                  return (
                  <tr
                    key={rule.id}
                    className={isNewWeekdayGroup ? "border-t-2 border-slate-300" : "border-t border-slate-100"}
                  >
                    <td
                      className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2"
                      style={{ left: 0, minWidth: STICKY_WEEKDAY_WIDTH }}
                    >
                      {WEEKDAY_LABEL[rule.weekday] ?? rule.weekday}（{rule.weekday}）
                    </td>
                    <td
                      className="sticky z-10 whitespace-nowrap bg-white px-3 py-2"
                      style={{ left: STICKY_TIME_LEFT, minWidth: STICKY_TIME_WIDTH }}
                    >
                      {rule.time}
                    </td>
                    <td
                      className="sticky z-10 border-r border-slate-100 bg-white px-3 py-2"
                      style={{ left: STICKY_ROOM_LEFT, minWidth: STICKY_ROOM_WIDTH }}
                    >
                      {rule.room}
                    </td>
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
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{rule.effective_date}</td>
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type SlotRulesSortableHeaderProps = {
  label: string;
  columnKey: SlotRulesSortKey;
  sortConfig: SlotRulesSortConfig;
  setSortConfig: (config: SlotRulesSortConfig) => void;
  thClassName?: string;
  thStyle?: CSSProperties;
};

function SlotRulesSortableHeader({
  label,
  columnKey,
  sortConfig,
  setSortConfig,
  thClassName,
  thStyle,
}: SlotRulesSortableHeaderProps) {
  const selectedDirection = sortConfig?.key === columnKey ? sortConfig.direction : "";
  const isStickyLeft = thStyle?.left != null;

  return (
    <th
      className={[
        "sticky top-0 whitespace-nowrap bg-slate-100 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-600",
        isStickyLeft ? "z-40" : "z-20",
        thClassName ?? "",
      ].join(" ")}
      style={thStyle}
    >
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span>{label}</span>
        <select
          aria-label={`Sort ${label}`}
          value={selectedDirection}
          onChange={(event) => {
            const direction = event.target.value as SortDirection | "";
            if (!direction) {
              setSortConfig(null);
              return;
            }
            setSortConfig({ key: columnKey, direction });
          }}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] normal-case text-slate-700"
        >
          <option value="">▽</option>
          <option value="asc">↑</option>
          <option value="desc">↓</option>
        </select>
      </div>
    </th>
  );
}
