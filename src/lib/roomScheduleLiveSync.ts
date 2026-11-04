import type { RoomScheduleRow } from "@/lib/roomScheduleAggregate";
import { isScheduleAttendanceMarked, parseRegularAttendanceRuleId } from "@/lib/lessonScheduleVersions";
import { resolveLessonOverride } from "@/lib/lessonDayOverrides";
import { PENDING_MAKEUP_TYPE_LABEL } from "@/lib/pendingMakeup";
import type { StudentLesson2026State } from "@/lib/studentLessonStorage";
import { parseLessonYearStateDbRow } from "@/lib/studentLessonStorage";

type LessonTypeForAttendance =
  | "恆常"
  | "補堂"
  | "加堂"
  | "取消"
  | typeof PENDING_MAKEUP_TYPE_LABEL;

function lessonTypeForAttendance(lessonType: string): LessonTypeForAttendance {
  if (
    lessonType === "恆常" ||
    lessonType === "補堂" ||
    lessonType === "加堂" ||
    lessonType === "取消" ||
    lessonType === PENDING_MAKEUP_TYPE_LABEL
  ) {
    return lessonType;
  }
  return "恆常";
}

/** 將 Supabase 即時推送的 year state 套用到房間課表列 */
export function patchRoomRowsFromLessonState(
  rows: RoomScheduleRow[],
  studentId: string,
  state: StudentLesson2026State,
  opts?: { skipRowKeys?: Set<string> },
): RoomScheduleRow[] {
  const skip = opts?.skipRowKeys;
  return rows.map((r) => {
    if (r.studentId !== studentId) return r;
    if (skip?.has(r.rowKey)) return r;

    const attended = isScheduleAttendanceMarked(state.attendance, {
      attendanceKey: r.attendanceKey,
      dateIso: r.dateIso,
      lessonType: lessonTypeForAttendance(r.lessonType),
      scheduleRuleId: r.scheduleRuleId ?? parseRegularAttendanceRuleId(r.attendanceKey) ?? undefined,
    });

    if (r.lessonType === "補堂") {
      return r.attended === attended ? r : { ...r, attended };
    }

    const hasSlotId = Boolean(String(r.scheduleRuleId ?? "").trim());
    const ovSummary = resolveLessonOverride(state.overrides, {
      dateIso: r.dateIso,
      scheduleRuleId: r.scheduleRuleId,
      allowDateFallback: true,
    });
    const ovTutor = resolveLessonOverride(state.overrides, {
      dateIso: r.dateIso,
      scheduleRuleId: r.scheduleRuleId,
      // Do not re-apply a date-wide tutor onto slotted lessons during live sync.
      allowDateFallback: !hasSlotId,
    });
    let note = r.note;
    let tutor = r.tutor;

    if (ovSummary && ovSummary.lessonSummary !== undefined) {
      note = String(ovSummary.lessonSummary ?? "").trim();
    }
    if (ovTutor && ovTutor.tutor !== undefined) {
      const t = String(ovTutor.tutor ?? "").trim();
      if (t) tutor = t;
      // Empty string = clear override and keep the row's room-slot / built tutor.
    }

    if (r.attended === attended && r.note === note && r.tutor === tutor) return r;
    return { ...r, attended, note, tutor };
  });
}

export function parseLessonYearStateFromRealtimeRow(
  row: Record<string, unknown>,
): { studentId: string; state: StudentLesson2026State } | null {
  const studentId = String(row.student_id ?? "").trim();
  if (!studentId) return null;
  return { studentId, state: parseLessonYearStateDbRow(row) };
}
