"use client";

import type { CSSProperties } from "react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ROOM_GROUPS,
  type DayTimetableCell,
  type DayTimetablePayload,
} from "@/lib/dayTimetableShared";
import type {
  DayTimetableFeePaymentTone,
  DayTimetableStyleSettings,
} from "@/lib/dayTimetableStyleSettings";
import { deleteTimetableDayRemark, upsertTimetableDayRemark } from "@/lib/studentLessonStorage";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import { normalizeStudentId } from "@/lib/studentId";

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
import type { DayTimetableUiLocale } from "@/lib/dayTimetableUiStrings";
import { dayTimetableTableStrings, formatFeeHeavyLine } from "@/lib/dayTimetableUiStrings";

const TD_BASE = "h-9 border border-slate-300 px-2 py-1 text-sm";
const TD_BASE_WIDE = "h-9 border border-slate-300 px-3 py-1 text-sm";

export function formatExamDateSlashed(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
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
): CSSProperties | undefined {
  if (!tone || tone === "ok") return undefined;
  const color =
    tone === "many_months_unpaid" ? style.feeArrearsStripeHex : style.feeUnpaidStripeHex;
  // inset box-shadow survives Daily page `!border-0` (showPeriodSeparatorOnly).
  return { boxShadow: `inset 4px 0 0 0 ${color}` };
}

function cellSurface(
  item: DayTimetableCell | undefined,
  textTone: "dark" | "muted",
  feeTone: DayTimetableFeePaymentTone | undefined,
  timetableStyle: DayTimetableStyleSettings,
): { className: string; style?: CSSProperties; isDarkBg: boolean } {
  const td = textTone === "dark" ? TD_BASE : TD_BASE_WIDE;
  const lightText = textTone === "dark" ? "text-slate-800" : "text-slate-700";
  if (!item) {
    return {
      className: `${td} bg-white ${lightText}`,
      isDarkBg: false,
    };
  }
  const stripe = feeStripeStyle(feeTone, timetableStyle);
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
  /** `en`：Regular timetable page */
  uiLocale?: DayTimetableUiLocale;
};

const COLS_PER_ROOM = 3;

export default function DayTimetableTable({
  payload,
  emptyMessage,
  showRegularCapacitySummary = false,
  showPeriodSeparatorOnly = false,
  uiLocale = "zh",
}: Props) {
  const t = dayTimetableTableStrings[uiLocale];
  const {
    rowFrames,
    byTimeRoom,
    examById,
    regularPeriodMaxByRoom,
    dateIso,
    feePaymentToneByStudentId,
    timetableStyle,
  } = payload;
  const noGridCls = showPeriodSeparatorOnly ? "!border-0" : "";
  const [hoverPanel, setHoverPanel] = useState<{
    studentId: string;
    name: string;
    scheduleRemarks: string;
    roomIdx: number;
  } | null>(null);
  const [remarksById, setRemarksById] = useState<Record<string, string>>(payload.timetableRemarksById ?? {});
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const hideHoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setRemarksById(payload.timetableRemarksById ?? {});
    setHoverPanel(null);
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

  function openHover(
    studentId: string,
    name: string,
    scheduleRemarks: string,
    roomIdx: number,
  ) {
    if (hideHoverTimerRef.current) {
      window.clearTimeout(hideHoverTimerRef.current);
      hideHoverTimerRef.current = null;
    }
    setHoverPanel({ studentId, name, scheduleRemarks, roomIdx });
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

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
      <p className="border-b border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-700">{t.examBlurbTitle}</span>
        {t.examDateBlurb}
        <span className="ml-2 text-slate-500">{t.remarkBlurb}</span>
      </p>
      <p className="border-b border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600">
        <span className="font-semibold text-slate-700">{t.coloursLegendTitle}</span>
        {t.coloursIntroBeforeSwatches}
        <span
          className="mx-1 inline-block h-3 w-5 rounded-sm align-[-2px] ring-1 ring-violet-200/80"
          style={{ backgroundColor: timetableStyle.rescheduleCellBgHex }}
          title={t.swatchTitleResched}
        />{" "}
        {t.coloursBetweenSwatches}
        <span
          className="mx-1 inline-block h-3 w-5 rounded-sm align-[-2px] ring-1 ring-amber-200/80"
          style={{ backgroundColor: timetableStyle.extraCellBgHex }}
          title={t.swatchTitleExtra}
        />{" "}
        {t.coloursAfterExtraSwatch}
        {t.feeIntro}
        <span
          className="mx-1 inline-block h-3 w-1.5 rounded-sm align-middle"
          style={{ backgroundColor: timetableStyle.feeUnpaidStripeHex }}
        />
        {t.feeBetweenStripes}
        <span
          className="mx-1 inline-block h-3 w-1.5 rounded-sm align-middle"
          style={{ backgroundColor: timetableStyle.feeArrearsStripeHex }}
        />{" "}
        {formatFeeHeavyLine(
          uiLocale,
          timetableStyle.feeLookbackMonths,
          timetableStyle.feeHeavyUnpaidThreshold,
        )}
      </p>
      {showRegularCapacitySummary ? (
        <p className="border-b border-slate-200 bg-emerald-50/80 px-3 py-2 text-xs text-slate-700">
          <span className="font-semibold text-slate-800">{t.capacityLabel}</span>
          {t.capacityBlurbBeforeLink}
          <Link href="/rooms" className="font-semibold text-[#1d76c2] underline">
            Rooms
          </Link>
          {t.capacityBlurbAfterLink}
        </p>
      ) : null}
      <table className="min-w-[960px] w-full border-collapse text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th
              rowSpan={2}
              className="w-14 border border-slate-300 px-2 py-2 text-left text-base font-semibold text-slate-800"
            >
              {t.time}
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
                {t.name}
              </th>,
              <th
                key={`grade-${room}`}
                className="w-16 border border-slate-300 px-2 py-2 text-left text-sm font-semibold text-slate-900"
              >
                {t.grade}
              </th>,
              <th
                key={`exam-${room}`}
                title={t.examThTitle}
                className="w-28 border border-slate-300 px-3 py-2 text-left text-sm font-semibold text-slate-900"
              >
                {t.examHeader}
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
                        const feeTone = item
                          ? feeToneForStudent(feePaymentToneByStudentId, item.studentId)
                          : undefined;
                        const nameSurf = cellSurface(item, "dark", feeTone, timetableStyle);
                        const gradeSurf = cellSurface(item, "dark", feeTone, timetableStyle);
                        const examSurf = cellSurface(item, "muted", feeTone, timetableStyle);
                        return (
                          <Fragment key={`${frame.time}-${idx}-${room}`}>
                            <td className={`${nameSurf.className} ${noGridCls} overflow-visible`} style={nameSurf.style}>
                              {item ? (
                                <div
                                  className="relative"
                                  onMouseEnter={() =>
                                    openHover(
                                      item.studentId,
                                      item.name,
                                      item.scheduleRemarks,
                                      roomIdx,
                                    )
                                  }
                                  onMouseLeave={() => closeHoverLater(item.studentId)}
                                >
                                  <Link
                                    href={`/students/${encodeURIComponent(normalizeStudentId(item.studentId))}/lessons`}
                                    className={`${nameSurf.isDarkBg ? "text-white" : "text-[#1d76c2]"} hover:underline`}
                                  >
                                    {item.name}
                                    {(remarksById[item.studentId] ?? "").trim() ? (
                                      <span
                                        className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                                          nameSurf.isDarkBg ? "bg-white/70" : "bg-slate-400"
                                        }`}
                                        title={t.remarkHasNote}
                                        aria-hidden
                                      />
                                    ) : null}
                                  </Link>
                                  {item.pendingMakeupLabel ? (
                                    <p className="mt-0.5 text-[10px] font-semibold leading-tight text-amber-900">
                                      {item.pendingMakeupLabel}
                                    </p>
                                  ) : null}
                                  {hoverPanel?.studentId === item.studentId ? (
                                    <div
                                      role="dialog"
                                      aria-label={t.remarks}
                                      className={[
                                        "absolute z-50 w-72 rounded-lg border border-slate-300 bg-white p-2 shadow-2xl ring-1 ring-slate-200",
                                        roomIdx >= 2
                                          ? "right-0 top-0 -translate-x-full -translate-y-0 pr-1"
                                          : "left-0 top-full mt-1",
                                      ].join(" ")}
                                      onMouseEnter={keepHoverOpen}
                                      onMouseLeave={() => closeHoverLater(item.studentId)}
                                    >
                                      <p className="text-xs font-semibold text-slate-800">{item.name}</p>
                                      <p className="mb-1 mt-0.5 text-[11px] font-semibold tracking-wide text-slate-500">
                                        {t.remarks}
                                        <span className="ml-1 font-normal text-slate-400">
                                          ({t.remarkHoverHint})
                                        </span>
                                      </p>
                                      {item.scheduleRemarks.trim() ? (
                                        <p className="mb-2 rounded-md bg-slate-50 px-2 py-1 text-[11px] leading-relaxed text-slate-600">
                                          <span className="font-medium text-slate-700">
                                            {t.lessonSummaryLabel}:{" "}
                                          </span>
                                          {item.scheduleRemarks.trim()}
                                        </p>
                                      ) : null}
                                      <textarea
                                        value={remarksById[item.studentId] ?? ""}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setRemarksById((prev) => ({
                                            ...prev,
                                            [item.studentId]: v,
                                          }));
                                          scheduleSave(item.studentId, v);
                                        }}
                                        placeholder={t.remarkPlaceholder}
                                        rows={3}
                                        className="w-full resize-y rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/20"
                                      />
                                      <p className="mt-1 text-[11px] text-slate-500">
                                        {savingById[item.studentId] ? t.saving : t.autoSaved}
                                      </p>
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                ""
                              )}
                            </td>
                            <td className={`${gradeSurf.className} w-16 ${noGridCls}`} style={gradeSurf.style}>
                              {formatGradeDisplay(item?.grade ?? "")}
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
                      {t.balanceRow}
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
  );
}
