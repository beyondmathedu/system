"use client";

import type { CSSProperties } from "react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ROOM_GROUPS,
  type DayTimetableCell,
  type DayTimetablePayload,
} from "@/lib/dayTimetableGrid";
import { deleteTimetableDayRemark, upsertTimetableDayRemark } from "@/lib/studentLessonStorage";
import { normalizeStudentId } from "@/lib/studentId";

const TD_BASE = "h-9 border border-slate-300 px-2 py-1 text-sm text-slate-800";
const TD_BASE_WIDE = "h-9 border border-slate-300 px-3 py-1 text-sm text-slate-700";

export function formatExamDateSlashed(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function cellSurface(
  item: DayTimetableCell | undefined,
  textTone: "dark" | "muted",
): { className: string; style?: CSSProperties } {
  if (!item) {
    return {
      className: `${textTone === "dark" ? TD_BASE : TD_BASE_WIDE} bg-white`,
    };
  }
  if (item.lessonType === "補堂") {
    return {
      className: `${textTone === "dark" ? TD_BASE : TD_BASE_WIDE} bg-emerald-100 text-slate-800`,
    };
  }
  const tutor = item.tutorDisplay.trim();
  if (!tutor || tutor === "待定" || tutor === "—") {
    return {
      className: `${textTone === "dark" ? TD_BASE : TD_BASE_WIDE} bg-slate-100`,
    };
  }
  const hex = item.tutorColorHex;
  if (!hex) {
    return {
      className: `${textTone === "dark" ? TD_BASE : TD_BASE_WIDE} bg-slate-100`,
    };
  }
  return {
    className: textTone === "dark" ? TD_BASE : TD_BASE_WIDE,
    style: { backgroundColor: hex },
  };
}

type Props = {
  payload: DayTimetablePayload;
  emptyMessage: string;
  /** 恆常班時間表：每個時段下方顯示各房「恆常人數／上限／餘額」 */
  showRegularCapacitySummary?: boolean;
  /** 只用每個時段的一條分隔線；不畫每行格線（供 Daily 頁） */
  showPeriodSeparatorOnly?: boolean;
};

const COLS_PER_ROOM = 3;

export default function DayTimetableTable({
  payload,
  emptyMessage,
  showRegularCapacitySummary = false,
  showPeriodSeparatorOnly = false,
}: Props) {
  const { rowFrames, byTimeRoom, examById, regularPeriodMaxByRoom, dateIso } = payload;
  const noGridCls = showPeriodSeparatorOnly ? "!border-0" : "";
  const [hoverStudentId, setHoverStudentId] = useState<string | null>(null);
  const [remarksById, setRemarksById] = useState<Record<string, string>>(payload.timetableRemarksById ?? {});
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const hideHoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setRemarksById(payload.timetableRemarksById ?? {});
    setHoverStudentId(null);
  }, [payload.timetableRemarksById, payload.dateIso]);

  const flushSave = useCallback(async (studentId: string, nextText: string) => {
    setSavingById((prev) => ({ ...prev, [studentId]: true }));
    try {
      if (nextText.trim()) await upsertTimetableDayRemark(studentId, dateIso, nextText.trim());
      else await deleteTimetableDayRemark(studentId, dateIso);
    } finally {
      setSavingById((prev) => ({ ...prev, [studentId]: false }));
    }
  }, [dateIso]);

  function scheduleSave(studentId: string, nextText: string) {
    const old = saveTimersRef.current.get(studentId);
    if (old) window.clearTimeout(old);
    const t = window.setTimeout(() => {
      saveTimersRef.current.delete(studentId);
      void flushSave(studentId, nextText);
    }, 600);
    saveTimersRef.current.set(studentId, t);
  }

  useEffect(() => {
    return () => {
      for (const t of saveTimersRef.current.values()) window.clearTimeout(t);
      saveTimersRef.current.clear();
      if (hideHoverTimerRef.current) window.clearTimeout(hideHoverTimerRef.current);
      hideHoverTimerRef.current = null;
    };
  }, []);

  function openHover(studentId: string) {
    if (hideHoverTimerRef.current) {
      window.clearTimeout(hideHoverTimerRef.current);
      hideHoverTimerRef.current = null;
    }
    setHoverStudentId(studentId);
  }

  function closeHoverLater(studentId: string) {
    if (hideHoverTimerRef.current) window.clearTimeout(hideHoverTimerRef.current);
    hideHoverTimerRef.current = window.setTimeout(() => {
      setHoverStudentId((prev) => (prev === studentId ? null : prev));
      hideHoverTimerRef.current = null;
    }, 380);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
      <p className="border-b border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-700">考試日期</span>
        欄：與各學生在「學生獨立課堂」頁（Students → 該生 → Lessons）所填寫的考試日期相同，由系統同步讀取。
      </p>
      {showRegularCapacitySummary ? (
        <p className="border-b border-slate-200 bg-emerald-50/80 px-3 py-2 text-xs text-slate-700">
          <span className="font-semibold text-slate-800">餘額列</span>
          ：各房各時段下方綠底列為「恆常人數／上限／餘額」；上限可在{" "}
          <Link href="/rooms" className="font-semibold text-[#1d76c2] underline">
            Rooms
          </Link>{" "}
          編輯（未設定則用預設：B、M前 5；M後、Hope 6；Hope 2 為 5）。
        </p>
      ) : null}
      <table className="bm-freeze-table min-w-[960px] w-full border-collapse text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th
              rowSpan={2}
              className="w-14 border border-slate-300 px-2 py-2 text-left text-base font-semibold text-slate-800"
            >
              時間
            </th>
            {ROOM_GROUPS.map((room) => (
              <th
                key={`room-${room}`}
                colSpan={COLS_PER_ROOM}
                className="border border-slate-300 px-2 py-2 text-center text-sm font-semibold text-slate-900"
              >
                {room}
              </th>
            ))}
          </tr>
          <tr>
            {ROOM_GROUPS.flatMap((room) => [
              <th
                key={`name-${room}`}
                className="border border-slate-300 px-3 py-2 text-left text-sm font-semibold text-slate-900"
              >
                姓名
              </th>,
              <th
                key={`grade-${room}`}
                className="w-16 border border-slate-300 px-2 py-2 text-left text-sm font-semibold text-slate-900"
              >
                年級
              </th>,
              <th
                key={`exam-${room}`}
                title="與該學生在學生獨立課堂頁設定的考試日期相同"
                className="w-28 border border-slate-300 px-3 py-2 text-left text-sm font-semibold text-slate-900"
              >
                考試日期
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rowFrames.length === 0 ? (
            <tr>
              <td
                colSpan={ROOM_GROUPS.length * COLS_PER_ROOM + 1}
                className="border border-slate-300 px-4 py-6 text-center text-sm text-slate-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rowFrames.map((frame, frameIdx) => (
              <Fragment key={`slot-${frame.time}`}>
                {showPeriodSeparatorOnly && frameIdx > 0 ? (
                  <tr>
                    <td
                      colSpan={ROOM_GROUPS.length * COLS_PER_ROOM + 1}
                      className="h-0 border-t-2 border-slate-400 p-0"
                    />
                  </tr>
                ) : null}
                {Array.from({ length: frame.maxRows }, (_, idx) => {
                  const cells = ROOM_GROUPS.map((room) => byTimeRoom[`${frame.time}::${room}`] ?? []);
                  return (
                    <tr key={`${frame.time}-${idx}`}>
                      <td className={`border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 ${noGridCls}`}>
                        {idx === 0 ? frame.time : ""}
                      </td>
                      {ROOM_GROUPS.map((room, roomIdx) => {
                        const item = cells[roomIdx][idx];
                        const nameSurf = cellSurface(item, "dark");
                        const gradeSurf = cellSurface(item, "dark");
                        const examSurf = cellSurface(item, "muted");
                        return (
                          <Fragment key={`${frame.time}-${idx}-${room}`}>
                            <td className={`${nameSurf.className} ${noGridCls}`} style={nameSurf.style}>
                              {item ? (
                                <div
                                  className="relative"
                                  onMouseEnter={() => openHover(item.studentId)}
                                  onMouseLeave={() => closeHoverLater(item.studentId)}
                                >
                                  <Link
                                    href={`/students/${encodeURIComponent(normalizeStudentId(item.studentId))}/lessons`}
                                    className="text-[#1d76c2] hover:underline"
                                  >
                                    {item.name}
                                  </Link>
                                  {hoverStudentId === item.studentId ? (
                                    <div
                                      className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-slate-300 bg-white p-2 shadow-xl"
                                      onMouseEnter={() => openHover(item.studentId)}
                                      onMouseLeave={() => closeHoverLater(item.studentId)}
                                    >
                                      <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-600">
                                        Remarks
                                      </p>
                                      <textarea
                                        value={remarksById[item.studentId] ?? ""}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setRemarksById((prev) => ({ ...prev, [item.studentId]: v }));
                                          scheduleSave(item.studentId, v);
                                        }}
                                        placeholder="輸入備註（自動儲存）"
                                        rows={3}
                                        className="w-full resize-y rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/20"
                                      />
                                      <p className="mt-1 text-[11px] text-slate-500">
                                        {savingById[item.studentId] ? "儲存中..." : "已自動儲存"}
                                      </p>
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                ""
                              )}
                            </td>
                            <td className={`${gradeSurf.className} w-16 ${noGridCls}`} style={gradeSurf.style}>
                              {item?.grade ?? ""}
                            </td>
                            <td className={`${examSurf.className} w-28 ${noGridCls}`} style={examSurf.style}>
                              {item ? formatExamDateSlashed(examById[item.studentId] ?? "") : ""}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
                {showRegularCapacitySummary ? (
                  <tr key={`${frame.time}-cap`} className="bg-emerald-50/90">
                    <td className="border border-emerald-200/80 px-2 py-1.5 text-xs font-medium text-emerald-900">
                      餘額
                    </td>
                    {ROOM_GROUPS.map((room) => {
                      const slotKey = `${frame.time}::${room}`;
                      const list = byTimeRoom[slotKey] ?? [];
                      const regularCount = list.filter((c) => c.lessonType === "恆常").length;
                      const maxSlots = regularPeriodMaxByRoom[room] ?? 0;
                      const remaining = Math.max(0, maxSlots - regularCount);
                      return (
                        <td
                          key={`${frame.time}-cap-${room}`}
                          colSpan={COLS_PER_ROOM}
                          className="border border-emerald-200/80 px-2 py-1.5 text-xs text-emerald-950"
                        >
                          恆常{" "}
                          <span className="font-semibold tabular-nums">{regularCount}</span>
                          {" · "}
                          上限 <span className="tabular-nums">{maxSlots}</span>
                          {" · "}
                          餘{" "}
                          <span
                            className={`font-semibold tabular-nums ${remaining === 0 ? "text-amber-800" : ""}`}
                          >
                            {remaining}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ) : null}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
