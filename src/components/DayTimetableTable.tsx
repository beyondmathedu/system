"use client";

import type { CSSProperties } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ROOM_GROUPS,
  type DayTimetableCell,
  type DayTimetablePayload,
  type RoomGroup,
} from "@/lib/dayTimetableShared";
import type {
  DayTimetableFeePaymentTone,
  DayTimetableStyleSettings,
} from "@/lib/dayTimetableStyleSettings";
import { deleteTimetableDayRemark, upsertTimetableDayRemark } from "@/lib/studentLessonStorage";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import { normalizeStudentId } from "@/lib/studentId";
import { buildRoomPageHref } from "@/lib/roomConstants";

function feeToneForStudent(
  feePaymentToneByStudentId: Record<string, DayTimetableFeePaymentTone>,
  studentId: string,
): DayTimetableFeePaymentTone {
  return (
    feePaymentToneByStudentId[studentId] ??
    feePaymentToneByStudentId[normalizeStudentId(studentId)] ??
    "ok"
  );
}
import { formatGradeDisplay } from "@/lib/grade";
import { dayTimetableTableStrings } from "@/lib/dayTimetableUiStrings";

const TD_BASE = "h-9 border border-slate-300 px-2 py-1 text-sm";
const TD_BASE_WIDE = "h-9 border border-slate-300 px-3 py-1 text-sm";

export function formatExamDateSlashed(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** Daily compact name (`中文 暱稱`) → two lines. */
function splitTimetableDisplayName(name: string): { line1: string; line2?: string } {
  const trimmed = name.trim();
  const space = trimmed.indexOf(" ");
  if (space <= 0) return { line1: trimmed };
  const line1 = trimmed.slice(0, space);
  const line2 = trimmed.slice(space + 1).trim();
  if (!line2) return { line1 };
  return { line1, line2 };
}

function mergeCellStyle(...parts: (CSSProperties | undefined)[]): CSSProperties | undefined {
  const o: CSSProperties = {};
  for (const p of parts) {
    if (p) Object.assign(o, p);
  }
  return Object.keys(o).length ? o : undefined;
}

function isDarkHexBackground(hex: string | undefined | null): boolean {
  const h = String(hex ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(h);
  if (!m) return false;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  // Relative luminance (sRGB-ish). Lower = darker.
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 140;
}

function feeStripeStyle(
  tone: DayTimetableFeePaymentTone | undefined,
  style: DayTimetableStyleSettings,
  side: "left" | "right" = "left",
): CSSProperties | undefined {
  if (!tone || tone === "ok") return undefined;
  const color =
    tone === "many_months_unpaid" ? style.feeArrearsStripeHex : style.feeUnpaidStripeHex;
  // inset box-shadow survives Daily page `!border-0` (showPeriodSeparatorOnly).
  return {
    boxShadow: side === "right" ? `inset -4px 0 0 0 ${color}` : `inset 4px 0 0 0 ${color}`,
  };
}

function cellSurface(
  item: DayTimetableCell | undefined,
  textTone: "dark" | "muted",
  feeTone: DayTimetableFeePaymentTone | undefined,
  timetableStyle: DayTimetableStyleSettings,
  opts?: { feeStripe?: boolean; feeStripeSide?: "left" | "right" },
): { className: string; style?: CSSProperties; isDarkBg: boolean } {
  const includeFeeStripe = opts?.feeStripe !== false;
  const feeStripeSide = opts?.feeStripeSide ?? "left";
  const td = textTone === "dark" ? TD_BASE : TD_BASE_WIDE;
  const lightText = textTone === "dark" ? "text-slate-800" : "text-slate-700";
  if (!item) {
    return {
      className: `${td} bg-white ${lightText}`,
      isDarkBg: false,
    };
  }
  const stripe = includeFeeStripe ? feeStripeStyle(feeTone, timetableStyle, feeStripeSide) : undefined;
  if (item.lessonType === PENDING_MAKEUP_TYPE_LABEL) {
    return {
      className: `${td} text-amber-950`,
      style: mergeCellStyle({ backgroundColor: "#fef3c7" }, stripe),
      isDarkBg: false,
    };
  }
  if (item.lessonType === "補堂") {
    const bg = timetableStyle.rescheduleCellBgHex;
    const isDarkBg = isDarkHexBackground(bg);
    return {
      className: `${td} ${isDarkBg ? "text-white" : lightText}`,
      style: mergeCellStyle({ backgroundColor: bg }, stripe),
      isDarkBg,
    };
  }
  if (item.lessonType === "加堂") {
    const bg = timetableStyle.extraCellBgHex;
    const isDarkBg = isDarkHexBackground(bg);
    return {
      className: `${td} ${isDarkBg ? "text-white" : lightText}`,
      style: mergeCellStyle({ backgroundColor: bg }, stripe),
      isDarkBg,
    };
  }
  const tutor = item.tutorDisplay.trim();
  if (!tutor || tutor === "待定" || tutor === "—") {
    return {
      className: `${td} bg-slate-100 ${lightText}`,
      style: stripe,
      isDarkBg: false,
    };
  }
  const hex = item.tutorColorHex;
  if (!hex) {
    return {
      className: `${td} bg-slate-100 ${lightText}`,
      style: stripe,
      isDarkBg: false,
    };
  }
  const isDarkBg = isDarkHexBackground(hex);
  return {
    className: `${td} ${isDarkBg ? "text-white" : lightText}`,
    style: mergeCellStyle({ backgroundColor: hex }, stripe),
    isDarkBg,
  };
}

type Props = {
  payload: DayTimetablePayload;
  emptyMessage: string;
  /** 恆常班時間表：每個時段下方顯示各房「恆常人數／上限／餘額」 */
  showRegularCapacitySummary?: boolean;
  /** 只用每個時段的一條分隔線；不畫每行格線（供 Daily 頁） */
  showPeriodSeparatorOnly?: boolean;
  /** Daily：每個時段前重複 B／M前／… 房名與 Name／Grade／Exam 小標題 */
  repeatRoomHeadersPerTimeSlot?: boolean;
  /** 導師：只可查看，不可改備註、樣式或跳轉學生頁 */
  readOnly?: boolean;
  /** readOnly 時仍允許 Name 連到 /students/{id}/lessons */
  allowStudentNameLinks?: boolean;
  /** 不顯示備註（導師 Daily Timetable） */
  hideRemarks?: boolean;
  /** Link room headers to `/rooms/{slug}` with this query string */
  roomScheduleQuery?: string;
  /** `en`：Regular timetable page */
};

const COLS_PER_ROOM = 3;

const TH_TIME =
  "w-14 border border-slate-300 bg-slate-50 px-2 py-2 text-left text-base font-semibold text-slate-800";
const TH_ROOM_ROW1 =
  "border border-slate-300 bg-slate-50 px-2 py-2 text-center text-sm font-semibold text-slate-900";
const TH_SUB =
  "border border-slate-300 bg-slate-50 py-2 text-left text-sm font-semibold text-slate-900";
const TD_TIME =
  "border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800";
const TD_TIME_CAP =
  "border border-emerald-200/80 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-900";

export default function DayTimetableTable({
  payload,
  emptyMessage,
  showRegularCapacitySummary = false,
  showPeriodSeparatorOnly = false,
  repeatRoomHeadersPerTimeSlot = false,
  readOnly = false,
  allowStudentNameLinks = false,
  hideRemarks = false,
  roomScheduleQuery,
}: Props) {
  const t = dayTimetableTableStrings;
  const {
    rowFrames,
    byTimeRoom,
    examById,
    regularPeriodMaxByRoom,
    dateIso,
    feePaymentToneByStudentId,
    timetableStyle,
  } = payload;
  const { roomsForTable, omittedRoomsToday } = useMemo(() => {
    const withStudents = ROOM_GROUPS.filter((room) =>
      rowFrames.some((frame) => (byTimeRoom[`${frame.time}::${room}`] ?? []).length > 0),
    ) as RoomGroup[];
    const roomsForTable: RoomGroup[] =
      withStudents.length > 0 ? withStudents : [...ROOM_GROUPS];
    const omittedRoomsToday: RoomGroup[] =
      rowFrames.length > 0 && withStudents.length < ROOM_GROUPS.length
        ? (ROOM_GROUPS.filter((r) => !withStudents.includes(r)) as RoomGroup[])
        : [];
    return { roomsForTable, omittedRoomsToday };
  }, [rowFrames, byTimeRoom]);
  const roomColSpan = roomsForTable.length * COLS_PER_ROOM + 1;
  const noGridCls = showPeriodSeparatorOnly ? "!border-0" : "";
  const dailyCompactColumns = repeatRoomHeadersPerTimeSlot;
  const thNameClass = dailyCompactColumns
    ? `${TH_SUB} w-[5.75rem] max-w-[5.75rem] px-1 py-2 text-xs`
    : `${TH_SUB} px-3`;
  const thExamClass = dailyCompactColumns
    ? `${TH_SUB} w-14 max-w-14 px-1 py-2 text-center text-xs`
    : `${TH_SUB} w-20 px-2`;
  const tdNameExtra = dailyCompactColumns
    ? "w-[5.75rem] max-w-[5.75rem] min-h-9 !h-auto px-1 py-0.5 align-top"
    : "";
  const tdExamExtra = dailyCompactColumns ? "w-14 max-w-14 px-1 text-center text-xs tabular-nums" : "w-20";
  const [hoverPanel, setHoverPanel] = useState<{
    studentId: string;
    name: string;
    scheduleRemarks: string;
    roomIdx: number;
    anchorRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);
  const hoverPanelRef = useRef<HTMLDivElement | null>(null);
  const [hoverPanelSize, setHoverPanelSize] = useState<{ w: number; h: number }>({ w: 288, h: 240 });
  const [remarksById, setRemarksById] = useState<Record<string, string>>(
    hideRemarks ? {} : (payload.timetableRemarksById ?? {}),
  );
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const hideHoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setRemarksById(hideRemarks ? {} : (payload.timetableRemarksById ?? {}));
    setHoverPanel(null);
  }, [hideRemarks, payload.timetableRemarksById, payload.dateIso]);

  useEffect(() => {
    if (!hoverPanel) return;
    // After render, measure actual panel height to avoid jumping too far.
    const id = window.setTimeout(() => {
      const el = hoverPanelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setHoverPanelSize({ w: r.width, h: r.height });
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [hoverPanel]);

  const flushSave = useCallback(async (studentId: string, nextText: string) => {
    if (readOnly) return;
    setSavingById((prev) => ({ ...prev, [studentId]: true }));
    try {
      if (nextText.trim()) await upsertTimetableDayRemark(studentId, dateIso, nextText.trim());
      else await deleteTimetableDayRemark(studentId, dateIso);
    } finally {
      setSavingById((prev) => ({ ...prev, [studentId]: false }));
    }
  }, [dateIso, readOnly]);

  function scheduleSave(studentId: string, nextText: string) {
    if (readOnly) return;
    const old = saveTimersRef.current.get(studentId);
    if (old) window.clearTimeout(old);
    const t = window.setTimeout(() => {
      saveTimersRef.current.delete(studentId);
      void flushSave(studentId, nextText);
    }, 600);
    saveTimersRef.current.set(studentId, t);
  }

  useEffect(() => {
    const timersRef = saveTimersRef;
    return () => {
      for (const t of timersRef.current.values()) window.clearTimeout(t);
      timersRef.current.clear();
      if (hideHoverTimerRef.current) window.clearTimeout(hideHoverTimerRef.current);
      hideHoverTimerRef.current = null;
    };
  }, []);

  function openHover(params: {
    studentId: string;
    name: string;
    scheduleRemarks: string;
    roomIdx: number;
    anchorRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  }) {
    if (hideRemarks) return;
    if (hideHoverTimerRef.current) {
      window.clearTimeout(hideHoverTimerRef.current);
      hideHoverTimerRef.current = null;
    }
    setHoverPanel(params);
  }

  function closeHoverLater(studentId: string) {
    if (hideHoverTimerRef.current) window.clearTimeout(hideHoverTimerRef.current);
    hideHoverTimerRef.current = window.setTimeout(() => {
      setHoverPanel((prev) => (prev?.studentId === studentId ? null : prev));
      hideHoverTimerRef.current = null;
    }, 380);
  }

  function keepHoverOpen() {
    if (hideHoverTimerRef.current) {
      window.clearTimeout(hideHoverTimerRef.current);
      hideHoverTimerRef.current = null;
    }
  }

  function renderStudentNameLabel(
    item: DayTimetableCell,
    nameSurf: { isDarkBg: boolean },
    anchorId: string,
  ) {
    const nameBody = dailyCompactColumns ? (
      (() => {
        const { line1, line2 } = splitTimetableDisplayName(item.name);
        return line2 ? (
          <>
            <span className="block text-[13px] leading-snug">{line1}</span>
            <span className="block text-[11px] leading-snug">{line2}</span>
          </>
        ) : (
          <span className="block text-[13px] leading-snug">{line1}</span>
        );
      })()
    ) : (
      item.name
    );
    const remarkDot =
      hideRemarks ? null : (remarksById[item.studentId] ?? "").trim() ? (
        <span
          className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${
            nameSurf.isDarkBg ? "bg-white/70" : "bg-slate-400"
          }`}
          title={t.remarkHasNote}
          aria-hidden
        />
      ) : null;
    const isClickableName = !readOnly || allowStudentNameLinks;
    const className = isClickableName
      ? nameSurf.isDarkBg
        ? `text-sky-200 underline hover:text-white ${dailyCompactColumns ? "block leading-tight" : ""}`
        : `text-[#1d76c2] underline hover:opacity-90 ${dailyCompactColumns ? "block leading-tight" : ""}`
      : `${
          nameSurf.isDarkBg ? "text-white" : "text-slate-800"
        } ${dailyCompactColumns ? "block leading-tight" : ""}`;

    if (readOnly && !allowStudentNameLinks) {
      return (
        <span id={anchorId} className={className}>
          {nameBody}
          {remarkDot}
        </span>
      );
    }

    return (
      <Link id={anchorId} href={`/students/${encodeURIComponent(normalizeStudentId(item.studentId))}/lessons`} className={className}>
        {nameBody}
        {remarkDot}
      </Link>
    );
  }

  function effectiveRoomScheduleQuery(): string {
    if (roomScheduleQuery) return roomScheduleQuery;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
    if (!m) return "";
    const year = m[1];
    const month = String(Number(m[2]));
    return `year=${year}&month=${month}&period=custom&from=${dateIso}&to=${dateIso}`;
  }

  function renderRoomHeader(room: RoomGroup) {
    const href = buildRoomPageHref(room, effectiveRoomScheduleQuery());
    if (!href) return room;
    return (
      <Link href={href} className="text-[#1d76c2] hover:underline">
        {room}
      </Link>
    );
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-white">
      {omittedRoomsToday.length > 0 && !repeatRoomHeadersPerTimeSlot ? (
        <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t.roomsHiddenToday.replace(
            "{rooms}",
            omittedRoomsToday.join(", "),
          )}
        </p>
      ) : null}
      {repeatRoomHeadersPerTimeSlot ? (
        <p className="border-b border-slate-200 bg-sky-50/80 px-3 py-2 text-xs text-slate-700">
          <span className="font-semibold text-slate-800">{t.repeatSlotHint}</span>
          {omittedRoomsToday.length > 0 ? (
            <span className="mt-1 block font-normal text-slate-600">
              {t.roomsHiddenToday.replace(
                "{rooms}",
                omittedRoomsToday.join(", "),
              )}
            </span>
          ) : null}
        </p>
      ) : null}
      <div className="max-h-[min(72vh,calc(100vh-10rem))] overflow-auto rounded-b-lg">
      <table className="min-w-[960px] w-full border-collapse text-sm">
        {repeatRoomHeadersPerTimeSlot ? (
          <thead className="sr-only">
            <tr>
              <th scope="col">{t.time}</th>
              {roomsForTable.flatMap((room) => [
                <th key={`sr-name-${room}`} scope="col">
                  {room} — {t.name}
                </th>,
                <th key={`sr-grade-${room}`} scope="col">
                  {room} — {t.grade}
                </th>,
                <th key={`sr-exam-${room}`} scope="col">
                  {room} — {t.examHeader}
                </th>,
              ])}
            </tr>
          </thead>
        ) : (
          <thead className="bg-slate-50">
            <tr>
              <th rowSpan={2} className={TH_TIME}>
                {t.time}
              </th>
              {roomsForTable.map((room) => (
                <th
                  key={`room-${room}`}
                  colSpan={COLS_PER_ROOM}
                  className={TH_ROOM_ROW1}
                >
                  {renderRoomHeader(room)}
                </th>
              ))}
            </tr>
            <tr>
              {roomsForTable.flatMap((room) => [
                <th key={`name-${room}`} className={thNameClass}>
                  {t.name}
                </th>,
                <th
                  key={`grade-${room}`}
                  className={`${TH_SUB} w-16 px-2`}
                >
                  {t.grade}
                </th>,
                <th key={`exam-${room}`} title={t.examThTitle} className={thExamClass}>
                  {t.examHeader}
                </th>,
              ])}
            </tr>
          </thead>
        )}
        <tbody>
          {rowFrames.length === 0 ? (
            <tr>
              <td
                colSpan={roomColSpan}
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
                      colSpan={roomColSpan}
                      className="h-0 border-t-2 border-slate-400 p-0"
                    />
                  </tr>
                ) : null}
                {repeatRoomHeadersPerTimeSlot ? (
                  <>
                    <tr className="bg-slate-50">
                      <th
                        rowSpan={2}
                        scope="row"
                        className={`${TH_TIME} align-middle text-center text-sm`}
                      >
                        {frame.time}
                      </th>
                      {roomsForTable.map((room) => (
                        <th
                          key={`${frame.time}-slot-h1-${room}`}
                          colSpan={COLS_PER_ROOM}
                          scope="colgroup"
                          className={TH_ROOM_ROW1}
                        >
                          {renderRoomHeader(room)}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-slate-50">
                      {roomsForTable.flatMap((room) => [
                        <th key={`${frame.time}-slot-h2-${room}-n`} className={thNameClass}>
                          {t.name}
                        </th>,
                        <th key={`${frame.time}-slot-h2-${room}-g`} className={`${TH_SUB} w-16 px-2`}>
                          {t.grade}
                        </th>,
                        <th
                          key={`${frame.time}-slot-h2-${room}-e`}
                          title={t.examThTitle}
                          className={thExamClass}
                        >
                          {t.examHeader}
                        </th>,
                      ])}
                    </tr>
                  </>
                ) : null}
                {Array.from({ length: frame.maxRows }, (_, idx) => {
                  const cells = roomsForTable.map((room) => byTimeRoom[`${frame.time}::${room}`] ?? []);
                  const timeCell =
                    repeatRoomHeadersPerTimeSlot ? "" : idx === 0 ? frame.time : "";
                  return (
                    <tr key={`${frame.time}-${idx}`}>
                      <td className={`${TD_TIME} ${noGridCls}`}>{timeCell}</td>
                      {roomsForTable.map((room, roomIdx) => {
                        const item = cells[roomIdx][idx];
                        const feeTone = item
                          ? feeToneForStudent(feePaymentToneByStudentId, item.studentId)
                          : undefined;
                        const nameSurf = cellSurface(item, "dark", feeTone, timetableStyle, {
                          feeStripe: true,
                          feeStripeSide: "left",
                        });
                        const gradeSurf = cellSurface(item, "dark", feeTone, timetableStyle, { feeStripe: false });
                        const examSurf = cellSurface(item, "muted", feeTone, timetableStyle, {
                          feeStripe: true,
                          feeStripeSide: "right",
                        });
                        return (
                          <Fragment key={`${frame.time}-${idx}-${room}`}>
                            <td
                              className={`${nameSurf.className} ${tdNameExtra} ${noGridCls} overflow-visible`}
                              style={nameSurf.style}
                            >
                              {item ? (
                                hideRemarks ? (
                                  <>
                                    {renderStudentNameLabel(
                                      item,
                                      nameSurf,
                                      `tt-hover-${frame.time}-${idx}-${room}-${item.studentId}`,
                                    )}
                                    {item.pendingMakeupLabel ? (
                                      <p className="mt-0.5 text-[10px] font-semibold leading-tight text-amber-900">
                                        {item.pendingMakeupLabel}
                                      </p>
                                    ) : null}
                                  </>
                                ) : (
                                <div
                                  className="relative"
                                  onMouseEnter={() =>
                                    openHover({
                                      studentId: item.studentId,
                                      name: item.name,
                                      scheduleRemarks: item.scheduleRemarks,
                                      roomIdx,
                                      anchorRect: ((): {
                                        left: number;
                                        top: number;
                                        right: number;
                                        bottom: number;
                                        width: number;
                                        height: number;
                                      } => {
                                        const el = document.getElementById(`tt-hover-${frame.time}-${idx}-${room}-${item.studentId}`);
                                        if (!el) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
                                        const r = el.getBoundingClientRect();
                                        return {
                                          left: r.left,
                                          top: r.top,
                                          right: r.right,
                                          bottom: r.bottom,
                                          width: r.width,
                                          height: r.height,
                                        };
                                      })(),
                                    })
                                  }
                                  onMouseLeave={() => closeHoverLater(item.studentId)}
                                >
                                  {renderStudentNameLabel(
                                    item,
                                    nameSurf,
                                    `tt-hover-${frame.time}-${idx}-${room}-${item.studentId}`,
                                  )}
                                  {item.pendingMakeupLabel ? (
                                    <p className="mt-0.5 text-[10px] font-semibold leading-tight text-amber-900">
                                      {item.pendingMakeupLabel}
                                    </p>
                                  ) : null}
                                  {hoverPanel?.studentId === item.studentId ? (
                                    <span className="sr-only">{t.remarkClickOpen}</span>
                                  ) : null}
                                </div>
                                )
                              ) : null}
                            </td>
                            <td className={`${gradeSurf.className} w-16 ${noGridCls}`} style={gradeSurf.style}>
                              {formatGradeDisplay(item?.grade ?? "")}
                            </td>
                            <td className={`${examSurf.className} ${tdExamExtra} ${noGridCls}`} style={examSurf.style}>
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
                    <td className={`${TD_TIME_CAP} border-emerald-200/80`}>
                      {t.balanceRow}
                    </td>
                    {roomsForTable.map((room) => {
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
                          {t.regularCount}{" "}
                          <span className="font-semibold tabular-nums">{regularCount}</span>
                          {" · "}
                          {t.cap} <span className="tabular-nums">{maxSlots}</span>
                          {" · "}
                          {t.remaining}{" "}
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
      {hoverPanel && !hideRemarks ? (
        <div
          role="dialog"
          aria-label={t.remarks}
          className="fixed z-[9999] w-72 rounded-lg border border-slate-300 bg-white p-2 shadow-2xl ring-1 ring-slate-200"
          style={((): CSSProperties => {
            const PANEL_W = hoverPanelSize.w || 288;
            const PANEL_H = hoverPanelSize.h || 240;
            const PAD = 8;
            const GAP = 4;
            const r = hoverPanel.anchorRect;
            const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
            const vh = typeof window === "undefined" ? 800 : window.innerHeight;
            const preferAbove = r.bottom + PANEL_H > vh - PAD;
            let top = preferAbove ? r.top - PANEL_H - GAP : r.bottom + GAP;
            if (top < PAD) top = PAD;
            if (top > vh - PANEL_H - PAD) top = Math.max(PAD, vh - PANEL_H - PAD);
            const preferRightAlign = hoverPanel.roomIdx >= 2;
            // Keep panel close to the anchor; align to left edge by default.
            let left = preferRightAlign ? r.right - PANEL_W : r.left;
            if (left < PAD) left = PAD;
            if (left > vw - PANEL_W - PAD) left = Math.max(PAD, vw - PANEL_W - PAD);
            return { top, left };
          })()}
          ref={hoverPanelRef}
          onMouseEnter={keepHoverOpen}
          onMouseLeave={() => closeHoverLater(hoverPanel.studentId)}
        >
          <p className="text-xs font-semibold text-slate-800">{hoverPanel.name}</p>
          <p className="mb-1 mt-0.5 text-[11px] font-semibold tracking-wide text-slate-500">
            {t.remarks}
            <span className="ml-1 font-normal text-slate-400">
              ({readOnly ? "View only" : t.remarkHoverHint})
            </span>
          </p>
          {hoverPanel.scheduleRemarks.trim() ? (
            <p className="mb-2 rounded-md bg-slate-50 px-2 py-1 text-[11px] leading-relaxed text-slate-600">
              <span className="font-medium text-slate-700">{t.lessonSummaryLabel}: </span>
              {hoverPanel.scheduleRemarks.trim()}
            </p>
          ) : null}
          {readOnly ? (
            (remarksById[hoverPanel.studentId] ?? "").trim() ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs leading-relaxed text-slate-700">
                {(remarksById[hoverPanel.studentId] ?? "").trim()}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">—</p>
            )
          ) : (
            <>
              <textarea
                value={remarksById[hoverPanel.studentId] ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setRemarksById((prev) => ({
                    ...prev,
                    [hoverPanel.studentId]: v,
                  }));
                  scheduleSave(hoverPanel.studentId, v);
                }}
                placeholder={t.remarkPlaceholder}
                rows={3}
                className="w-full resize-y rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/20"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {savingById[hoverPanel.studentId] ? t.saving : t.autoSaved}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
