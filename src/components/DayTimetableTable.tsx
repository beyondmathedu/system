"use client";

import type { CSSProperties, DragEvent } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ROOM_GROUPS,
  type DayTimetableCell,
  type DayTimetablePayload,
  type RoomGroup,
} from "@/lib/dayTimetableShared";
import {
  applyTempRoomMoves,
  findOriginalRoomForStudent,
  parseTempRoomMoveKey,
  resolveTempDragStudentIds,
  studentIdsInSameTimeRange,
  tempRoomMoveKey,
  type TempRoomMoveMap,
} from "@/lib/dayTimetableTempLayout";
import type {
  DayTimetableFeePaymentTone,
  DayTimetableStyleSettings,
} from "@/lib/dayTimetableStyleSettings";
import { upsertTimetablePermanentRemark } from "@/lib/studentTimetableRemarkClient";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import { normalizeStudentId } from "@/lib/studentId";
import { buildRoomPageHref } from "@/lib/roomConstants";
import "./dayTimetableNameCell.css";

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

import { formatVisibleExamDateSlashed } from "@/lib/examDateVisibility";

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
  if (item.isInactive) {
    const stripe = includeFeeStripe ? feeStripeStyle(feeTone, timetableStyle, feeStripeSide) : undefined;
    return {
      className: `${td} text-slate-500`,
      style: mergeCellStyle(
        {
          backgroundColor: "#f1f5f9",
          backgroundImage:
            "repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(148,163,184,0.25) 4px, rgba(148,163,184,0.25) 5px)",
        },
        stripe,
      ),
      isDarkBg: false,
    };
  }
  if (item.lessonType === "取消") {
    const stripe = includeFeeStripe ? feeStripeStyle(feeTone, timetableStyle, feeStripeSide) : undefined;
    return {
      className: `${td} text-slate-500 line-through decoration-slate-400`,
      style: mergeCellStyle({ backgroundColor: "#f8fafc" }, stripe),
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
  /** 與 Daily Timetable 相同：Name 兩行（中文／暱稱）與欄寬 */
  compactStudentNames?: boolean;
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
  /**
   * Optional: override the room column order.
   * Default uses ROOM_GROUPS from the timetable shared lib.
   */
  roomGroupsForTable?: readonly RoomGroup[];
  /** Daily page: allow per-room show/hide toggles to reduce empty columns. */
  enableRoomVisibilityToggle?: boolean;
  /**
   * Daily page: drag students across room columns for the same time only.
   * Page-local layout; not saved; refresh clears.
   */
  enableTempRoomLayout?: boolean;
};

const COLS_PER_ROOM = 3;

const TH_TIME =
  "w-14 border border-slate-300 bg-slate-50 px-2 py-2 text-left text-base font-semibold text-slate-800";
/** Daily compact: keep columns tight so 5 rooms fit on iPad; leftover space stays on the right. */
const TH_TIME_DAILY =
  "border border-slate-300 bg-slate-50 align-middle text-center font-semibold text-slate-800 w-9 min-w-[2.25rem] max-w-[2.25rem] px-0 py-1 text-[9px] leading-tight sm:w-10 sm:min-w-[2.5rem] sm:max-w-[2.5rem] sm:px-0.5 sm:py-1.5 sm:text-[10px] lg:w-11 lg:min-w-[2.75rem] lg:max-w-[2.75rem] lg:text-xs";
const TH_ROOM_ROW1 =
  "border border-slate-300 bg-slate-50 px-2 py-2 text-center text-sm font-semibold text-slate-900";
const TH_ROOM_ROW1_DAILY =
  "border border-slate-300 bg-slate-50 px-0 py-1 text-center text-[9px] font-semibold leading-tight text-slate-900 sm:px-0.5 sm:py-1.5 sm:text-[10px] lg:px-1 lg:py-1.5 lg:text-xs";
const TH_SUB =
  "border border-slate-300 bg-slate-50 py-2 text-left text-sm font-semibold text-slate-900";
/** Daily Name / Grade / Exam — labels visible; widths sized to fit ~5 rooms on iPad portrait. */
const TH_SUB_DAILY_NAME =
  `${TH_SUB} w-[3.4rem] min-w-[3.4rem] max-w-[3.4rem] px-0.5 py-1 text-center text-[9px] leading-tight sm:w-[3.8rem] sm:min-w-[3.8rem] sm:max-w-[3.8rem] sm:text-[10px] lg:w-[4.2rem] lg:min-w-[4.2rem] lg:max-w-[4.2rem] lg:text-[11px]`;
const TH_SUB_DAILY_GRADE =
  `${TH_SUB} w-8 min-w-[2rem] max-w-[2rem] px-0 py-1 text-center text-[9px] leading-tight sm:w-[2.2rem] sm:min-w-[2.2rem] sm:max-w-[2.2rem] sm:text-[10px] lg:w-9 lg:min-w-[2.25rem] lg:max-w-[2.25rem] lg:text-[10px]`;
const TH_SUB_DAILY_EXAM =
  `${TH_SUB} w-8 min-w-[2rem] max-w-[2rem] px-0 py-1 text-center text-[9px] leading-tight sm:w-[2.2rem] sm:min-w-[2.2rem] sm:max-w-[2.2rem] sm:text-[10px] lg:w-9 lg:min-w-[2.25rem] lg:max-w-[2.25rem] lg:text-[10px]`;
const TD_TIME =
  "border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800";
const TD_TIME_DAILY =
  "border border-slate-300 bg-white px-0 py-0.5 text-center text-[9px] font-medium leading-tight text-slate-800 sm:px-0.5 sm:text-[10px] lg:text-xs";
const TD_DAILY_NAME_EXTRA =
  "w-[3.4rem] min-w-[3.4rem] max-w-[3.4rem] !h-auto px-0.5 py-0.5 align-top break-words overflow-hidden sm:w-[3.8rem] sm:min-w-[3.8rem] sm:max-w-[3.8rem] lg:w-[4.2rem] lg:min-w-[4.2rem] lg:max-w-[4.2rem]";
const TD_DAILY_GRADE_EXTRA =
  "w-8 min-w-[2rem] max-w-[2rem] px-0 py-0.5 text-center text-[9px] leading-tight sm:w-[2.2rem] sm:min-w-[2.2rem] sm:max-w-[2.2rem] sm:text-[10px] lg:w-9 lg:min-w-[2.25rem] lg:max-w-[2.25rem] lg:text-[10px]";
const TD_DAILY_EXAM_EXTRA =
  "w-8 min-w-[2rem] max-w-[2rem] px-0 py-0.5 text-center text-[9px] leading-tight tabular-nums sm:w-[2.2rem] sm:min-w-[2.2rem] sm:max-w-[2.2rem] sm:text-[10px] lg:w-9 lg:min-w-[2.25rem] lg:max-w-[2.25rem] lg:text-[10px]";
const TD_REGULAR_NAME_EXTRA =
  "tt-name-cell @container/name min-h-9 !h-auto align-top break-words px-2 py-1 sm:px-3";
const TD_TIME_CAP =
  "border border-emerald-200/80 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-900";

export default function DayTimetableTable({
  payload,
  emptyMessage,
  showRegularCapacitySummary = false,
  compactStudentNames = false,
  showPeriodSeparatorOnly = false,
  repeatRoomHeadersPerTimeSlot = false,
  readOnly = false,
  allowStudentNameLinks = false,
  hideRemarks = false,
  roomScheduleQuery,
  roomGroupsForTable,
  enableRoomVisibilityToggle = false,
  enableTempRoomLayout = false,
}: Props) {
  const t = dayTimetableTableStrings;
  const {
    rowFrames: payloadRowFrames,
    byTimeRoom: payloadByTimeRoom,
    examById,
    regularPeriodMaxByRoom,
    roomDisplayLabels,
    dateIso,
    feePaymentToneByStudentId,
    timetableStyle,
  } = payload;
  const baseRoomGroups: readonly RoomGroup[] = roomGroupsForTable ?? ROOM_GROUPS;
  const [tempRoomMoves, setTempRoomMoves] = useState<TempRoomMoveMap>({});
  /** Layout-only columns appended on the right (may have no tutor that day). */
  const [tempAddedRooms, setTempAddedRooms] = useState<RoomGroup[]>([]);
  /** Which header instance is editing: `${room}:::${instanceId}` */
  const [renamingHeaderKey, setRenamingHeaderKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  /** Selected student keys (`time|||studentId`) for multi-drag, same time only. */
  const [tempSelectedKeys, setTempSelectedKeys] = useState<string[]>([]);
  const tempSelectAnchorRef = useRef<string | null>(null);

  useEffect(() => {
    setTempRoomMoves({});
    setTempAddedRooms([]);
    setRenamingHeaderKey(null);
    setDragOverKey(null);
    setTempSelectedKeys([]);
    tempSelectAnchorRef.current = null;
  }, [dateIso]);

  const effectiveRoomGroups = useMemo(() => {
    const seen = new Set<string>(baseRoomGroups);
    const extras = tempAddedRooms.filter((room) => {
      if (seen.has(room)) return false;
      seen.add(room);
      return true;
    });
    return [...baseRoomGroups, ...extras] as RoomGroup[];
  }, [baseRoomGroups, tempAddedRooms]);

  const times = useMemo(() => payloadRowFrames.map((f) => f.time), [payloadRowFrames]);
  const layout = useMemo(() => {
    if (
      !enableTempRoomLayout ||
      (Object.keys(tempRoomMoves).length === 0 && tempAddedRooms.length === 0)
    ) {
      return { byTimeRoom: payloadByTimeRoom, rowFrames: payloadRowFrames };
    }
    return applyTempRoomMoves(payloadByTimeRoom, tempRoomMoves, effectiveRoomGroups, times);
  }, [
    enableTempRoomLayout,
    tempRoomMoves,
    tempAddedRooms.length,
    payloadByTimeRoom,
    payloadRowFrames,
    effectiveRoomGroups,
    times,
  ]);
  const byTimeRoom = layout.byTimeRoom;
  const rowFrames = layout.rowFrames;
  const tempMoveCount = Object.keys(tempRoomMoves).length;

  const roomLabel = useCallback(
    (room: RoomGroup) => roomDisplayLabels?.[room] ?? room,
    [roomDisplayLabels],
  );
  const knownRoomsForAdd = useMemo(() => {
    const seen = new Set<string>();
    const out: RoomGroup[] = [];
    for (const room of [
      ...ROOM_GROUPS,
      ...(payload.extraRoomGroups ?? []),
      ...Object.keys(roomDisplayLabels ?? {}),
    ]) {
      if (!room || seen.has(room)) continue;
      seen.add(room);
      out.push(room);
    }
    return out;
  }, [payload.extraRoomGroups, roomDisplayLabels]);
  const addableRooms = useMemo(
    () => knownRoomsForAdd.filter((room) => !effectiveRoomGroups.includes(room)),
    [knownRoomsForAdd, effectiveRoomGroups],
  );
  const tempAddedRoomSet = useMemo(() => new Set(tempAddedRooms), [tempAddedRooms]);

  const addTempRoomColumn = useCallback(
    (room: RoomGroup) => {
      const key = room.trim();
      if (!key) return;
      setTempAddedRooms((prev) => (prev.includes(key) || baseRoomGroups.includes(key) ? prev : [...prev, key]));
    },
    [baseRoomGroups],
  );
  const addNextTempColumn = useCallback(() => {
    let n = 1;
    const used = new Set(effectiveRoomGroups);
    while (used.has(`Temp ${n}`)) n += 1;
    const name = `Temp ${n}`;
    addTempRoomColumn(name);
    const instanceId = repeatRoomHeadersPerTimeSlot
      ? (payloadRowFrames[0]?.time ?? "thead")
      : "thead";
    setRenamingHeaderKey(`${name}:::${instanceId}`);
  }, [addTempRoomColumn, effectiveRoomGroups, payloadRowFrames, repeatRoomHeadersPerTimeSlot]);
  const removeTempRoomColumn = useCallback((room: RoomGroup) => {
    setTempAddedRooms((prev) => prev.filter((r) => r !== room));
    setRenamingHeaderKey((cur) => (cur?.startsWith(`${room}:::`) ? null : cur));
    setTempRoomMoves((prev) => {
      let changed = false;
      const next: TempRoomMoveMap = { ...prev };
      for (const [key, toRoom] of Object.entries(prev)) {
        if (toRoom === room) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);
  const renameTempRoomColumn = useCallback(
    (from: RoomGroup, toRaw: string) => {
      const to = toRaw.trim().replace(/\s+/g, " ");
      if (!to || to === from) {
        setRenamingHeaderKey(null);
        return;
      }
      const taken =
        baseRoomGroups.includes(to) ||
        tempAddedRooms.some((room) => room === to && room !== from);
      if (taken) {
        window.alert(`“${to}” is already used as a room column.`);
        return;
      }
      setTempAddedRooms((prev) => prev.map((room) => (room === from ? to : room)));
      setTempRoomMoves((prev) => {
        let changed = false;
        const next: TempRoomMoveMap = { ...prev };
        for (const [key, toRoom] of Object.entries(prev)) {
          if (toRoom === from) {
            next[key] = to;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setRenamingHeaderKey(null);
    },
    [baseRoomGroups, tempAddedRooms],
  );
  const resetTempLayout = useCallback(() => {
    setTempRoomMoves({});
    setTempAddedRooms([]);
    setRenamingHeaderKey(null);
    setDragOverKey(null);
    setTempSelectedKeys([]);
    tempSelectAnchorRef.current = null;
  }, []);

  const repeatSlotRoomHint = useMemo(
    () => effectiveRoomGroups.map((room) => roomDisplayLabels?.[room] ?? room).join(", "),
    [effectiveRoomGroups, roomDisplayLabels],
  );
  const { roomsForTable, omittedRoomsToday } = useMemo(() => {
    // Temp layout needs empty / added rooms as drop targets.
    if (enableTempRoomLayout) {
      return { roomsForTable: [...effectiveRoomGroups] as RoomGroup[], omittedRoomsToday: [] as RoomGroup[] };
    }
    const withStudents = baseRoomGroups.filter((room) =>
      rowFrames.some((frame) => (byTimeRoom[`${frame.time}::${room}`] ?? []).length > 0),
    ) as RoomGroup[];
    const roomsForTable: RoomGroup[] =
      withStudents.length > 0 ? withStudents : [...baseRoomGroups];
    const omittedRoomsToday: RoomGroup[] =
      rowFrames.length > 0 && withStudents.length < baseRoomGroups.length
        ? (baseRoomGroups.filter((r) => !withStudents.includes(r)) as RoomGroup[])
        : [];
    return { roomsForTable, omittedRoomsToday };
  }, [rowFrames, byTimeRoom, baseRoomGroups, effectiveRoomGroups, enableTempRoomLayout]);

  const tempSelectedSet = useMemo(() => new Set(tempSelectedKeys), [tempSelectedKeys]);

  const orderedStudentIdsAtTime = useCallback(
    (time: string) => {
      const ids: string[] = [];
      for (const room of roomsForTable) {
        for (const c of byTimeRoom[`${time}::${room}`] ?? []) {
          ids.push(c.studentId);
        }
      }
      return ids;
    },
    [byTimeRoom, roomsForTable],
  );

  const selectTempStudent = useCallback(
    (time: string, studentId: string, mode: "replace" | "toggle" | "range") => {
      const key = tempRoomMoveKey(time, studentId);
      if (mode === "replace") {
        setTempSelectedKeys([key]);
        tempSelectAnchorRef.current = key;
        return;
      }
      if (mode === "toggle") {
        setTempSelectedKeys((prev) => {
          const sameTime = prev.filter((k) => k.startsWith(`${time}|||`));
          const base = sameTime.length > 0 ? sameTime : [];
          if (base.includes(key)) {
            const next = base.filter((k) => k !== key);
            tempSelectAnchorRef.current = next[next.length - 1] ?? key;
            return next;
          }
          tempSelectAnchorRef.current = key;
          return [...base, key];
        });
        return;
      }
      // range (Shift): same time only, from last anchor
      const anchor = tempSelectAnchorRef.current;
      const anchorParsed = anchor ? parseTempRoomMoveKey(anchor) : null;
      if (!anchorParsed || anchorParsed.time !== time) {
        setTempSelectedKeys([key]);
        tempSelectAnchorRef.current = key;
        return;
      }
      const rangeIds = studentIdsInSameTimeRange(
        orderedStudentIdsAtTime(time),
        anchorParsed.studentId,
        studentId,
      );
      setTempSelectedKeys(rangeIds.map((id) => tempRoomMoveKey(time, id)));
    },
    [orderedStudentIdsAtTime],
  );

  const moveStudentsToRoom = useCallback(
    (time: string, studentIds: readonly string[], toRoom: RoomGroup) => {
      setTempRoomMoves((prev) => {
        let changed = false;
        const next: TempRoomMoveMap = { ...prev };
        for (const studentId of studentIds) {
          const original = findOriginalRoomForStudent(payloadByTimeRoom, time, studentId);
          const key = tempRoomMoveKey(time, studentId);
          if (!original || original === toRoom) {
            if (key in next) {
              delete next[key];
              changed = true;
            }
            continue;
          }
          if (next[key] === toRoom) continue;
          next[key] = toRoom;
          changed = true;
        }
        return changed ? next : prev;
      });
    },
    [payloadByTimeRoom],
  );

  const clearTempSelection = useCallback(() => {
    setTempSelectedKeys([]);
    tempSelectAnchorRef.current = null;
  }, []);

  /** iPad / touch: tap a destination room (same time) after selecting students. */
  const moveTempSelectionToRoom = useCallback(
    (time: string, toRoom: RoomGroup) => {
      const ids = tempSelectedKeys
        .map(parseTempRoomMoveKey)
        .filter((p): p is { time: string; studentId: string } => Boolean(p && p.time === time))
        .map((p) => p.studentId);
      if (ids.length === 0) return false;
      moveStudentsToRoom(time, ids, toRoom);
      clearTempSelection();
      return true;
    },
    [tempSelectedKeys, moveStudentsToRoom, clearTempSelection],
  );

  const selectedTimeForMove = useMemo(() => {
    if (tempSelectedKeys.length === 0) return null;
    const first = parseTempRoomMoveKey(tempSelectedKeys[0]!);
    if (!first) return null;
    if (!tempSelectedKeys.every((k) => k.startsWith(`${first.time}|||`))) return null;
    return first.time;
  }, [tempSelectedKeys]);
  const noGridCls = showPeriodSeparatorOnly ? "!border-0" : "";
  const dailyCompactColumns = repeatRoomHeadersPerTimeSlot;
  const dailyNameCells = dailyCompactColumns || compactStudentNames;
  const fluidNameCell = showRegularCapacitySummary && !compactStudentNames;
  const thNameClass = dailyNameCells ? TH_SUB_DAILY_NAME : `${TH_SUB} min-w-0 px-2 sm:px-3`;
  const thGradeClass = dailyCompactColumns ? TH_SUB_DAILY_GRADE : `${TH_SUB} w-16 shrink-0 px-2`;
  const thExamClass = dailyCompactColumns ? TH_SUB_DAILY_EXAM : `${TH_SUB} w-20 shrink-0 px-2`;
  const tdNameExtra = dailyNameCells ? TD_DAILY_NAME_EXTRA : fluidNameCell ? TD_REGULAR_NAME_EXTRA : "";
  const tdGradeExtra = dailyCompactColumns ? TD_DAILY_GRADE_EXTRA : "w-16 shrink-0";
  const tdExamExtra = dailyCompactColumns ? TD_DAILY_EXAM_EXTRA : "w-20 shrink-0";
  const thTimeClass = dailyCompactColumns ? TH_TIME_DAILY : TH_TIME;
  const thRoomRow1Class = dailyCompactColumns ? TH_ROOM_ROW1_DAILY : TH_ROOM_ROW1;
  const tdTimeClass = dailyCompactColumns ? TD_TIME_DAILY : TD_TIME;
  const tableClassName =
    dailyCompactColumns
      ? "tt-daily-table w-max max-w-none table-fixed border-collapse text-[9px] sm:text-[10px] lg:text-xs"
      : compactStudentNames && showRegularCapacitySummary
        ? "w-full min-w-0 table-fixed border-collapse text-[10px] sm:text-xs lg:text-sm"
        : fluidNameCell
          ? "tt-regular-table w-full min-w-0 table-fixed border-collapse text-[10px] sm:text-xs lg:text-sm"
          : "min-w-[960px] w-full border-collapse text-sm";
  const [hoverPanel, setHoverPanel] = useState<{
    studentId: string;
    name: string;
    scheduleRemarks: string;
    roomIdx: number;
    anchorRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);
  const hoverPanelRef = useRef<HTMLDivElement | null>(null);
  const [hoverPanelSize, setHoverPanelSize] = useState<{ w: number; h: number }>({ w: 288, h: 240 });
  const [permanentRemarksById, setPermanentRemarksById] = useState<Record<string, string>>(
    hideRemarks ? {} : (payload.timetablePermanentRemarksById ?? {}),
  );
  const [savingPermanentById, setSavingPermanentById] = useState<Record<string, boolean>>({});
  const [hiddenRooms, setHiddenRooms] = useState<RoomGroup[]>([]);
  const [showRemarkDots, setShowRemarkDots] = useState(true);
  const [showAllRemarks, setShowAllRemarks] = useState(false);
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const hideHoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enableTempRoomLayout) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setTempSelectedKeys([]);
      tempSelectAnchorRef.current = null;
      setRenamingHeaderKey(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableTempRoomLayout]);

  useEffect(() => {
    setPermanentRemarksById(hideRemarks ? {} : (payload.timetablePermanentRemarksById ?? {}));
    setHoverPanel(null);
  }, [hideRemarks, payload.timetablePermanentRemarksById, payload.dateIso]);

  useEffect(() => {
    setHiddenRooms((prev) => prev.filter((room) => roomsForTable.includes(room)));
  }, [roomsForTable]);

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

  const flushSavePermanent = useCallback(async (studentId: string, nextText: string) => {
    if (readOnly) return;
    setSavingPermanentById((prev) => ({ ...prev, [studentId]: true }));
    try {
      await upsertTimetablePermanentRemark(studentId, nextText.trim());
    } finally {
      setSavingPermanentById((prev) => ({ ...prev, [studentId]: false }));
    }
  }, [readOnly]);

  function scheduleSavePermanent(studentId: string, nextText: string) {
    if (readOnly) return;
    const key = `perm:${studentId}`;
    const old = saveTimersRef.current.get(key);
    if (old) window.clearTimeout(old);
    const t = window.setTimeout(() => {
      saveTimersRef.current.delete(key);
      void flushSavePermanent(studentId, nextText);
    }, 600);
    saveTimersRef.current.set(key, t);
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

  const visibleRoomsForTable = useMemo(() => {
    if (!enableRoomVisibilityToggle) return roomsForTable;
    return roomsForTable.filter((room) => !hiddenRooms.includes(room));
  }, [enableRoomVisibilityToggle, hiddenRooms, roomsForTable]);

  const visibleRoomColSpan = visibleRoomsForTable.length * COLS_PER_ROOM + 1;

  const toggleRoomVisibility = useCallback((room: RoomGroup) => {
    setHiddenRooms((prev) =>
      prev.includes(room) ? prev.filter((item) => item !== room) : [...prev, room],
    );
  }, []);

  function renderEyeIcon(hidden: boolean) {
    const iconClass = dailyCompactColumns ? "h-2.5 w-2.5 sm:h-3 sm:w-3" : "h-3.5 w-3.5";
    if (hidden) {
      return (
        <svg viewBox="0 0 20 20" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M2.5 2.5l15 15" strokeLinecap="round" />
          <path d="M8.9 4.2A8.7 8.7 0 0110 4.1c4.3 0 7.8 3 9 5.9a10.8 10.8 0 01-3.1 4.2" strokeLinecap="round" />
          <path d="M7 7a4 4 0 005.5 5.5" strokeLinecap="round" />
          <path d="M4.1 7.2A10.6 10.6 0 001 10c1.2 2.9 4.7 5.9 9 5.9 1 0 2-.2 2.9-.5" strokeLinecap="round" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 20 20" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M1 10c1.2-2.9 4.7-5.9 9-5.9S17.8 7.1 19 10c-1.2 2.9-4.7 5.9-9 5.9S2.2 12.9 1 10z" />
        <circle cx="10" cy="10" r="2.6" />
      </svg>
    );
  }

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

  function studentHasRemark(studentId: string): boolean {
    return Boolean((permanentRemarksById[studentId] ?? "").trim());
  }

  const tempDragActiveRef = useRef(false);

  function renderStudentNameLabel(
    item: DayTimetableCell,
    nameSurf: { isDarkBg: boolean },
    anchorId: string,
  ) {
    const nameBody = dailyNameCells ? (
      (() => {
        const { line1, line2 } = splitTimetableDisplayName(item.name);
        return line2 ? (
          <>
            <span className="block text-[9px] leading-snug sm:text-[10px] lg:text-[11px]">{line1}</span>
            <span className="block text-[8px] leading-snug sm:text-[9px] lg:text-[10px]">{line2}</span>
          </>
        ) : (
          <span className="block text-[9px] leading-snug sm:text-[10px] lg:text-[11px]">{line1}</span>
        );
      })()
    ) : fluidNameCell ? (
      <span className="tt-name-fluid block leading-tight">{item.name}</span>
    ) : (
      item.name
    );
    const remarkDot =
      hideRemarks || !showRemarkDots
        ? null
        : studentHasRemark(item.studentId)
          ? (
        <span
          className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${
            nameSurf.isDarkBg ? "bg-white/70" : "bg-slate-400"
          }`}
          title={t.remarkHasNote}
          aria-hidden
        />
      ) : null;
    const isClickableName = !readOnly || allowStudentNameLinks;
    const blockTight = dailyNameCells || fluidNameCell;
    const isCancelled = item.lessonType === "取消";
    const className = isCancelled
      ? `text-slate-500 line-through decoration-slate-400 ${
          isClickableName ? "hover:opacity-80" : ""
        } ${blockTight ? "block leading-tight" : ""}`
      : isClickableName
        ? nameSurf.isDarkBg
          ? `text-sky-200 underline hover:text-white ${blockTight ? "block leading-tight" : ""}`
          : `text-[#1d76c2] underline hover:opacity-90 ${blockTight ? "block leading-tight" : ""}`
        : `${
            nameSurf.isDarkBg ? "text-white" : "text-slate-800"
          } ${blockTight ? "block leading-tight" : ""}`;

    if (readOnly && !allowStudentNameLinks) {
      return (
        <span id={anchorId} className={className}>
          {nameBody}
          {remarkDot}
        </span>
      );
    }

    return (
      <Link
        id={anchorId}
        href={`/students/${encodeURIComponent(normalizeStudentId(item.studentId))}/lessons`}
        className={className}
        // Let the parent cell own HTML5 drag; default link drag blocks room moves.
        draggable={false}
        onClick={(e) => {
          if (tempDragActiveRef.current || e.metaKey || e.ctrlKey || e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {nameBody}
        {remarkDot}
      </Link>
    );
  }

  function renderInlineAllRemarks(item: DayTimetableCell, isDarkBg: boolean) {
    if (hideRemarks || !showAllRemarks) return null;
    const note = (permanentRemarksById[item.studentId] ?? "").trim();
    if (!note) return null;
    return (
      <p
        className={`mt-0.5 whitespace-pre-wrap break-words text-[8px] font-normal leading-snug no-underline sm:text-[9px] ${
          isDarkBg ? "text-white/85" : "text-slate-600"
        }`}
      >
        {note}
      </p>
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

  function renderRoomHeader(room: RoomGroup, instanceId: string) {
    const label = roomLabel(room);
    const href = buildRoomPageHref(room, effectiveRoomScheduleQuery(), payload.roomSlugByGroup);
    const isLayoutAdded = tempAddedRoomSet.has(room);
    const headerKey = `${room}:::${instanceId}`;
    const isEditingTitle = isLayoutAdded && renamingHeaderKey === headerKey;
    const headerLabel =
      href && !isLayoutAdded ? (
        <Link href={href} className="text-[#1d76c2] hover:underline">
          {label}
        </Link>
      ) : isLayoutAdded ? (
        isEditingTitle ? (
          <input
            key={headerKey}
            autoFocus
            defaultValue={room}
            className="w-full min-w-[2.5rem] max-w-[5.5rem] rounded border border-amber-400 bg-white px-0.5 py-0 text-center text-[9px] font-semibold leading-tight text-amber-950 sm:max-w-[6.5rem] sm:text-[10px] lg:text-xs"
            aria-label="Rename layout room"
            title="Rename"
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                renameTempRoomColumn(room, e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setRenamingHeaderKey(null);
              }
            }}
            onBlur={(e) => renameTempRoomColumn(room, e.currentTarget.value)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenamingHeaderKey(headerKey)}
            className="min-w-0 truncate text-amber-900 underline decoration-amber-300 decoration-dotted underline-offset-2 hover:text-amber-950"
            title="Click to rename"
          >
            {label}
          </button>
        )
      ) : (
        <span>{label}</span>
      );
    if (!enableRoomVisibilityToggle && !isLayoutAdded) return headerLabel;
    const hidden = hiddenRooms.includes(room);
    return (
      <div className="flex items-center justify-center gap-0.5 sm:gap-1">
        {enableRoomVisibilityToggle ? (
          <button
            type="button"
            onClick={() => toggleRoomVisibility(room)}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-800 sm:h-5 sm:w-5"
            aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
            title={hidden ? `Show ${label}` : `Hide ${label}`}
          >
            {renderEyeIcon(hidden)}
          </button>
        ) : null}
        <span className={`min-w-0 ${isEditingTitle ? "flex-1" : "truncate"}`}>{headerLabel}</span>
        {isLayoutAdded ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => removeTempRoomColumn(room)}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-amber-300 bg-amber-50 text-[10px] font-bold leading-none text-amber-900 hover:bg-amber-100 sm:h-5 sm:w-5"
            aria-label={`Remove ${label}`}
            title={`Remove layout column ${label}`}
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-slate-300 bg-white"
      onClick={(e) => {
        if (!enableTempRoomLayout || tempSelectedKeys.length === 0) return;
        const target = e.target;
        if (!(target instanceof Element)) return;
        if (target.closest("[data-tt-temp-select],[data-tt-temp-drop]")) return;
        clearTempSelection();
      }}
    >
      {omittedRoomsToday.length > 0 && !repeatRoomHeadersPerTimeSlot ? (
        <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t.roomsHiddenToday.replace(
            "{rooms}",
            omittedRoomsToday.map((room) => roomLabel(room)).join(", "),
          )}
        </p>
      ) : null}
      {repeatRoomHeadersPerTimeSlot ? (
        <p className="border-b border-slate-200 bg-sky-50/80 px-3 py-2 text-xs text-slate-700">
          <span className="font-semibold text-slate-800">
            Each time slot repeats room headers: {repeatSlotRoomHint} — Name, Gr., Exam — so columns
            stay clear when scrolling.
          </span>
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
      {enableTempRoomLayout ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <p>
            <span className="font-semibold">Layout only</span>
            {" · "}
            drag on desktop · on iPad: tap to select (tap more to multi-select) · tap empty same-time cell to move
            {" · "}
            same time only · not saved
            {tempSelectedKeys.length > 0 && selectedTimeForMove ? (
              <span className="ml-1 font-semibold text-sky-800">
                → tap an empty cell at {selectedTimeForMove} to move
              </span>
            ) : null}
            {tempMoveCount > 0 || tempAddedRooms.length > 0 || tempSelectedKeys.length > 0 ? (
              <span className="ml-1 font-semibold text-amber-800">
                (
                {tempSelectedKeys.length > 0 ? `${tempSelectedKeys.length} selected` : null}
                {tempSelectedKeys.length > 0 && (tempMoveCount > 0 || tempAddedRooms.length > 0)
                  ? ", "
                  : null}
                {tempMoveCount > 0 ? `${tempMoveCount} moved` : null}
                {tempMoveCount > 0 && tempAddedRooms.length > 0 ? ", " : null}
                {tempAddedRooms.length > 0 ? `${tempAddedRooms.length} room(s) added` : null}
                )
              </span>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5">
              <span className="sr-only">Add room</span>
              <select
                className="max-w-[11rem] rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-900"
                defaultValue=""
                onChange={(e) => {
                  const value = e.target.value;
                  e.target.value = "";
                  if (!value) return;
                  if (value === "__temp__") {
                    addNextTempColumn();
                    return;
                  }
                  addTempRoomColumn(value);
                }}
              >
                <option value="">+ Room</option>
                {addableRooms.map((room) => (
                  <option key={`add-room-${room}`} value={room}>
                    {roomLabel(room)}
                  </option>
                ))}
                <option value="__temp__">+ Temp</option>
              </select>
            </label>
            <button
              type="button"
              disabled={tempMoveCount === 0 && tempAddedRooms.length === 0}
              onClick={resetTempLayout}
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset layout
            </button>
          </div>
        </div>
      ) : null}
      {enableRoomVisibilityToggle || !hideRemarks ? (
        <div className="border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {enableRoomVisibilityToggle ? (
              <>
                <span className="text-xs font-semibold text-slate-600">Rooms</span>
                {roomsForTable.map((room) => {
                  const hidden = hiddenRooms.includes(room);
                  return (
                    <button
                      key={`room-visibility-${room}`}
                      type="button"
                      onClick={() => toggleRoomVisibility(room)}
                      className={[
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                        hidden
                          ? "border-slate-300 bg-slate-100 text-slate-500"
                          : "border-sky-200 bg-sky-50 text-slate-800",
                      ].join(" ")}
                      aria-pressed={!hidden}
                    >
                      {renderEyeIcon(hidden)}
                      {roomLabel(room)}
                    </button>
                  );
                })}
              </>
            ) : null}
            {!hideRemarks ? (
              <>
                {enableRoomVisibilityToggle ? (
                  <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" aria-hidden />
                ) : null}
                <span className="text-xs font-semibold text-slate-600">{t.remarkDotsLabel}</span>
                <button
                  type="button"
                  onClick={() => setShowRemarkDots((v) => !v)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                    showRemarkDots
                      ? "border-sky-200 bg-sky-50 text-slate-800"
                      : "border-slate-300 bg-slate-100 text-slate-500",
                  ].join(" ")}
                  aria-pressed={showRemarkDots}
                  title={showRemarkDots ? t.remarkDotsHide : t.remarkDotsShow}
                >
                  {renderEyeIcon(!showRemarkDots)}
                  {showRemarkDots ? t.remarkDotsHide : t.remarkDotsShow}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAllRemarks((v) => !v)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                    showAllRemarks
                      ? "border-sky-200 bg-sky-50 text-slate-800"
                      : "border-slate-300 bg-slate-100 text-slate-500",
                  ].join(" ")}
                  aria-pressed={showAllRemarks}
                  title={showAllRemarks ? t.remarkAllHide : t.remarkAllShow}
                >
                  {renderEyeIcon(!showAllRemarks)}
                  {showAllRemarks ? t.remarkAllHide : t.remarkAllShow}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="max-h-[min(72vh,calc(100vh-10rem))] overflow-auto rounded-b-lg">
      <div className={dailyCompactColumns ? "tt-daily-fit" : undefined}>
      <table className={tableClassName}>
        {dailyCompactColumns ? (
          <colgroup>
            <col className="tt-daily-col-time" />
            {visibleRoomsForTable.flatMap((room) => [
              <col key={`col-name-${room}`} className="tt-daily-col-name" />,
              <col key={`col-grade-${room}`} className="tt-daily-col-grade" />,
              <col key={`col-exam-${room}`} className="tt-daily-col-exam" />,
            ])}
          </colgroup>
        ) : fluidNameCell ? (
          <colgroup>
            <col className="tt-col-time" />
            {visibleRoomsForTable.flatMap((room) => [
              <col key={`col-name-${room}`} />,
              <col key={`col-grade-${room}`} className="tt-col-grade" />,
              <col key={`col-exam-${room}`} className="tt-col-exam" />,
            ])}
          </colgroup>
        ) : null}
        {repeatRoomHeadersPerTimeSlot ? (
          <thead className="sr-only">
            <tr>
              <th scope="col">{t.time}</th>
              {visibleRoomsForTable.flatMap((room) => [
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
              <th rowSpan={2} className={thTimeClass}>
                {t.time}
              </th>
              {visibleRoomsForTable.map((room) => (
                <th
                  key={`room-${room}`}
                  colSpan={COLS_PER_ROOM}
                  className={[
                    thRoomRow1Class,
                    tempAddedRoomSet.has(room) ? "!bg-amber-50" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {renderRoomHeader(room, "thead")}
                </th>
              ))}
            </tr>
            <tr>
              {visibleRoomsForTable.flatMap((room) => [
                <th key={`name-${room}`} className={thNameClass}>
                  {t.name}
                </th>,
                <th key={`grade-${room}`} className={thGradeClass}>
                  {t.grade}
                </th>,
                <th key={`exam-${room}`} title={t.examThTitle} className={thExamClass}>
                  {dailyCompactColumns ? "Exam" : t.examHeader}
                </th>,
              ])}
            </tr>
          </thead>
        )}
        <tbody>
          {rowFrames.length === 0 ? (
            <tr>
              <td
                colSpan={visibleRoomColSpan}
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
                      colSpan={visibleRoomColSpan}
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
                        className={thTimeClass}
                      >
                        {frame.time}
                      </th>
                      {visibleRoomsForTable.map((room) => (
                        <th
                          key={`${frame.time}-slot-h1-${room}`}
                          colSpan={COLS_PER_ROOM}
                          scope="colgroup"
                          className={[
                            thRoomRow1Class,
                            tempAddedRoomSet.has(room) ? "!bg-amber-50" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {renderRoomHeader(room, frame.time)}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-slate-50">
                      {visibleRoomsForTable.flatMap((room) => [
                        <th key={`${frame.time}-slot-h2-${room}-n`} className={thNameClass}>
                          {t.name}
                        </th>,
                        <th key={`${frame.time}-slot-h2-${room}-g`} className={thGradeClass}>
                          {t.grade}
                        </th>,
                        <th
                          key={`${frame.time}-slot-h2-${room}-e`}
                          title={t.examThTitle}
                          className={thExamClass}
                        >
                          {dailyCompactColumns ? "Exam" : t.examHeader}
                        </th>,
                      ])}
                    </tr>
                  </>
                ) : null}
                {Array.from({ length: frame.maxRows }, (_, idx) => {
                  const cells = visibleRoomsForTable.map((room) => byTimeRoom[`${frame.time}::${room}`] ?? []);
                  const timeCell =
                    repeatRoomHeadersPerTimeSlot ? "" : idx === 0 ? frame.time : "";
                  return (
                    <tr key={`${frame.time}-${idx}`}>
                      <td className={`${tdTimeClass} ${noGridCls}`}>{timeCell}</td>
                      {visibleRoomsForTable.map((room, roomIdx) => {
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
                        const dropKey = `${frame.time}::${room}`;
                        const isTempMoved =
                          enableTempRoomLayout &&
                          item != null &&
                          Boolean(tempRoomMoves[tempRoomMoveKey(frame.time, item.studentId)]);
                        const canDrag = Boolean(enableTempRoomLayout && item);
                        const isTapDropTarget =
                          Boolean(enableTempRoomLayout && selectedTimeForMove === frame.time);
                        const selectKey = item ? tempRoomMoveKey(frame.time, item.studentId) : "";
                        const isTempSelected = Boolean(item && tempSelectedSet.has(selectKey));
                        const nameCellClassName = [
                          nameSurf.className,
                          tdNameExtra,
                          noGridCls,
                          "relative",
                          showAllRemarks ? "!overflow-visible" : "overflow-visible",
                          canDrag ? "cursor-grab active:cursor-grabbing" : "",
                          !item && isTapDropTarget ? "cursor-pointer" : "",
                          isTempSelected ? "ring-2 ring-inset ring-sky-500" : "",
                          dragOverKey === dropKey || (!item && isTapDropTarget)
                            ? "ring-2 ring-inset ring-amber-400"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        const slotSurfClass = (surfClass: string, extra: string) =>
                          [
                            surfClass,
                            extra,
                            noGridCls,
                            "relative",
                            canDrag ? "cursor-grab active:cursor-grabbing" : "",
                            !item && isTapDropTarget ? "cursor-pointer" : "",
                            isTempSelected ? "ring-2 ring-inset ring-sky-500" : "",
                            dragOverKey === dropKey || (!item && isTapDropTarget)
                              ? "ring-2 ring-inset ring-amber-400"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ");
                        const onTempDragOver = enableTempRoomLayout
                          ? (e: DragEvent) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDragOverKey(dropKey);
                            }
                          : undefined;
                        const onTempDragLeave = enableTempRoomLayout
                          ? () => {
                              setDragOverKey((cur) => (cur === dropKey ? null : cur));
                            }
                          : undefined;
                        const onTempDrop = enableTempRoomLayout
                          ? (e: DragEvent) => {
                              e.preventDefault();
                              setDragOverKey(null);
                              const raw = e.dataTransfer.getData("application/x-tt-temp-room");
                              if (!raw) return;
                              try {
                                const data = JSON.parse(raw) as {
                                  time?: string;
                                  studentId?: string;
                                  studentIds?: string[];
                                };
                                if (!data.time) return;
                                if (data.time !== frame.time) return;
                                const ids =
                                  Array.isArray(data.studentIds) && data.studentIds.length > 0
                                    ? data.studentIds
                                    : data.studentId
                                      ? [data.studentId]
                                      : [];
                                if (ids.length === 0) return;
                                moveStudentsToRoom(data.time, ids, room);
                              } catch {
                                /* ignore bad payload */
                              }
                            }
                          : undefined;
                        const onTempDragStart = canDrag
                          ? (e: DragEvent) => {
                              tempDragActiveRef.current = true;
                              const studentIds = resolveTempDragStudentIds(
                                frame.time,
                                item!.studentId,
                                tempSelectedKeys,
                              );
                              if (studentIds.length === 1) {
                                const onlyKey = tempRoomMoveKey(frame.time, studentIds[0]);
                                if (!tempSelectedSet.has(onlyKey)) {
                                  setTempSelectedKeys([onlyKey]);
                                  tempSelectAnchorRef.current = onlyKey;
                                }
                              }
                              e.dataTransfer.setData(
                                "application/x-tt-temp-room",
                                JSON.stringify({
                                  time: frame.time,
                                  studentId: item!.studentId,
                                  studentIds,
                                  fromRoom: room,
                                }),
                              );
                              e.dataTransfer.effectAllowed = "move";
                            }
                          : undefined;
                        const onTempDragEnd = canDrag
                          ? () => {
                              setDragOverKey(null);
                              window.setTimeout(() => {
                                tempDragActiveRef.current = false;
                              }, 0);
                            }
                          : undefined;
                        const onTempSelectClick = canDrag
                          ? (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
                              if (e.shiftKey) {
                                selectTempStudent(frame.time, item!.studentId, "range");
                                return;
                              }
                              if (e.metaKey || e.ctrlKey) {
                                selectTempStudent(frame.time, item!.studentId, "toggle");
                                return;
                              }
                              // iPad / no-modifier: once anyone is selected at this time, further taps toggle.
                              const hasSameTimeSel = tempSelectedKeys.some((k) =>
                                k.startsWith(`${frame.time}|||`),
                              );
                              selectTempStudent(
                                frame.time,
                                item!.studentId,
                                hasSameTimeSel ? "toggle" : "replace",
                              );
                            }
                          : undefined;
                        const onTempTapDrop = isTapDropTarget
                          ? () => {
                              moveTempSelectionToRoom(frame.time, room);
                            }
                          : undefined;
                        const dragTitle = canDrag
                          ? isTempSelected && tempSelectedKeys.length > 1
                            ? `Selected ${tempSelectedKeys.length} · drag or tap empty cell to move`
                            : "Tap to select · tap more to multi-select · drag or tap empty cell to move"
                          : isTapDropTarget
                            ? "Tap to move selected students here"
                            : undefined;
                        const dragFillClass = [
                          "block h-full min-h-[1.75rem] w-full",
                          canDrag ? "cursor-grab active:cursor-grabbing" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        const cellBody = item ? (
                          <>
                            {renderStudentNameLabel(
                              item,
                              nameSurf,
                              `tt-hover-${frame.time}-${idx}-${room}-${item.studentId}`,
                            )}
                            {isTempMoved ? (
                              <p className="mt-0.5 text-[9px] font-semibold leading-tight text-amber-800">
                                moved
                              </p>
                            ) : null}
                            {isTempSelected && tempSelectedKeys.length > 1 ? (
                              <p className="mt-0.5 text-[9px] font-semibold leading-tight text-sky-700">
                                selected
                              </p>
                            ) : null}
                            {item.pendingMakeupLabel ? (
                              <p className="mt-0.5 text-[10px] font-semibold leading-tight text-amber-900">
                                {item.pendingMakeupLabel}
                              </p>
                            ) : null}
                            {item.lessonType === "取消" ? (
                              <p className="mt-0.5 text-[10px] font-semibold leading-tight text-slate-500 no-underline">
                                Cancelled
                              </p>
                            ) : null}
                            {item.isInactive ? (
                              <p className="mt-0.5 text-[10px] font-semibold leading-tight text-slate-500">
                                Inactive
                              </p>
                            ) : null}
                          </>
                        ) : null;
                        return (
                          <Fragment key={`${frame.time}-${idx}-${room}`}>
                            <td
                              className={nameCellClassName}
                              style={nameSurf.style}
                              onDragOver={onTempDragOver}
                              onDragLeave={onTempDragLeave}
                              onDrop={onTempDrop}
                            >
                              {item ? (
                                hideRemarks ? (
                                  <div
                                    className={dragFillClass}
                                    data-tt-temp-select="1"
                                    draggable={canDrag || undefined}
                                    onDragStart={onTempDragStart}
                                    onDragEnd={onTempDragEnd}
                                    onClick={onTempSelectClick}
                                    title={dragTitle}
                                  >
                                    {cellBody}
                                  </div>
                                ) : (
                                <div
                                  className={["relative", dragFillClass].join(" ")}
                                  data-tt-temp-select="1"
                                  draggable={canDrag || undefined}
                                  onDragStart={onTempDragStart}
                                  onDragEnd={onTempDragEnd}
                                  onClick={onTempSelectClick}
                                  title={dragTitle}
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
                                  {cellBody}
                                  {renderInlineAllRemarks(item, nameSurf.isDarkBg)}
                                  {hoverPanel?.studentId === item.studentId ? (
                                    <span className="sr-only">{t.remarkClickOpen}</span>
                                  ) : null}
                                </div>
                                )
                              ) : isTapDropTarget ? (
                                <button
                                  type="button"
                                  data-tt-temp-drop="1"
                                  className="block h-full min-h-[1.75rem] w-full"
                                  title={dragTitle}
                                  onClick={onTempTapDrop}
                                  aria-label={`Move selected students to ${roomLabel(room)}`}
                                />
                              ) : null}
                            </td>
                            <td
                              className={slotSurfClass(gradeSurf.className, tdGradeExtra)}
                              style={gradeSurf.style}
                              onDragOver={onTempDragOver}
                              onDragLeave={onTempDragLeave}
                              onDrop={onTempDrop}
                            >
                              {item ? (
                                <div
                                  className={`${dragFillClass} flex items-center justify-center`}
                                  data-tt-temp-select="1"
                                  draggable={canDrag || undefined}
                                  onDragStart={onTempDragStart}
                                  onDragEnd={onTempDragEnd}
                                  onClick={onTempSelectClick}
                                  title={dragTitle}
                                >
                                  {formatGradeDisplay(item.grade ?? "")}
                                </div>
                              ) : isTapDropTarget ? (
                                <button
                                  type="button"
                                  data-tt-temp-drop="1"
                                  className="block h-full min-h-[1.75rem] w-full"
                                  title={dragTitle}
                                  onClick={onTempTapDrop}
                                  aria-label={`Move selected students to ${roomLabel(room)}`}
                                />
                              ) : null}
                            </td>
                            <td
                              className={slotSurfClass(examSurf.className, tdExamExtra)}
                              style={examSurf.style}
                              onDragOver={onTempDragOver}
                              onDragLeave={onTempDragLeave}
                              onDrop={onTempDrop}
                            >
                              {item ? (
                                <div
                                  className={`${dragFillClass} flex items-center justify-center`}
                                  data-tt-temp-select="1"
                                  draggable={canDrag || undefined}
                                  onDragStart={onTempDragStart}
                                  onDragEnd={onTempDragEnd}
                                  onClick={onTempSelectClick}
                                  title={dragTitle}
                                >
                                  {formatVisibleExamDateSlashed(examById[item.studentId] ?? "")}
                                </div>
                              ) : isTapDropTarget ? (
                                <button
                                  type="button"
                                  data-tt-temp-drop="1"
                                  className="block h-full min-h-[1.75rem] w-full"
                                  title={dragTitle}
                                  onClick={onTempTapDrop}
                                  aria-label={`Move selected students to ${roomLabel(room)}`}
                                />
                              ) : null}
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
                    {visibleRoomsForTable.map((room) => {
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
            (permanentRemarksById[hoverPanel.studentId] ?? "").trim() ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs leading-relaxed text-slate-700">
                {(permanentRemarksById[hoverPanel.studentId] ?? "").trim()}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">—</p>
            )
          ) : (
            <>
              <textarea
                value={permanentRemarksById[hoverPanel.studentId] ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setPermanentRemarksById((prev) => ({
                    ...prev,
                    [hoverPanel.studentId]: v,
                  }));
                  scheduleSavePermanent(hoverPanel.studentId, v);
                }}
                placeholder={t.permanentRemarkPlaceholder}
                rows={3}
                className="w-full resize-y rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/20"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {savingPermanentById[hoverPanel.studentId] ? t.saving : t.autoSaved}
              </p>
            </>
          )}
        </div>
      ) : null}
      </div>
    </div>
  );
}
