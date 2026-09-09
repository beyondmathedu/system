import type { DayTimetableCell, DayTimetableRowFrame, RoomGroup } from "@/lib/dayTimetableShared";

/** Key: `${time}|||${studentId}` → temporary display room (page-local only). */
export type TempRoomMoveMap = Record<string, RoomGroup>;

export function tempRoomMoveKey(time: string, studentId: string): string {
  return `${time}|||${studentId}`;
}

export function parseTempRoomMoveKey(key: string): { time: string; studentId: string } | null {
  const sep = key.indexOf("|||");
  if (sep <= 0) return null;
  return { time: key.slice(0, sep), studentId: key.slice(sep + 3) };
}

/** Find which room column originally holds this student at this time. */
export function findOriginalRoomForStudent(
  byTimeRoom: Record<string, DayTimetableCell[]>,
  time: string,
  studentId: string,
): RoomGroup | null {
  const prefix = `${time}::`;
  for (const [key, list] of Object.entries(byTimeRoom)) {
    if (!key.startsWith(prefix)) continue;
    if (list.some((c) => c.studentId === studentId)) {
      return key.slice(prefix.length) as RoomGroup;
    }
  }
  return null;
}

/**
 * Students to move when dragging one cell.
 * If the dragged student is in a multi-selection at the same time, move all of them;
 * otherwise move only the dragged student.
 */
export function resolveTempDragStudentIds(
  time: string,
  draggedStudentId: string,
  selectedKeys: readonly string[],
): string[] {
  const selectedAtTime = selectedKeys
    .map(parseTempRoomMoveKey)
    .filter((p): p is { time: string; studentId: string } => Boolean(p && p.time === time))
    .map((p) => p.studentId);
  if (selectedAtTime.length > 1 && selectedAtTime.includes(draggedStudentId)) {
    return [...new Set(selectedAtTime)];
  }
  return [draggedStudentId];
}

/** Inclusive range of student ids between two anchors in a flat same-time order. */
export function studentIdsInSameTimeRange(
  orderedStudentIds: readonly string[],
  fromId: string,
  toId: string,
): string[] {
  const a = orderedStudentIds.indexOf(fromId);
  const b = orderedStudentIds.indexOf(toId);
  if (a < 0 || b < 0) return [toId];
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return orderedStudentIds.slice(start, end + 1);
}

/**
 * Apply page-local room moves for Daily Timetable layout.
 * Does not mutate the original map; same-time moves only (enforced by callers).
 */
export function applyTempRoomMoves(
  byTimeRoom: Record<string, DayTimetableCell[]>,
  moves: TempRoomMoveMap,
  roomGroups: readonly RoomGroup[],
  times: string[],
): { byTimeRoom: Record<string, DayTimetableCell[]>; rowFrames: DayTimetableRowFrame[] } {
  const next: Record<string, DayTimetableCell[]> = {};
  for (const [key, list] of Object.entries(byTimeRoom)) {
    next[key] = [...list];
  }
  for (const time of times) {
    for (const room of roomGroups) {
      const key = `${time}::${room}`;
      if (!next[key]) next[key] = [];
    }
  }

  for (const [moveKey, toRoom] of Object.entries(moves)) {
    const parsed = parseTempRoomMoveKey(moveKey);
    if (!parsed || !toRoom) continue;
    const { time, studentId } = parsed;

    let cell: DayTimetableCell | undefined;
    for (const [key, list] of Object.entries(next)) {
      if (!key.startsWith(`${time}::`)) continue;
      const idx = list.findIndex((c) => c.studentId === studentId);
      if (idx < 0) continue;
      cell = list[idx];
      next[key] = [...list.slice(0, idx), ...list.slice(idx + 1)];
      break;
    }
    if (!cell) continue;

    const destKey = `${time}::${toRoom}`;
    next[destKey] = [...(next[destKey] ?? []), cell];
  }

  const rowFrames: DayTimetableRowFrame[] = times.map((time) => {
    let maxRows = 1;
    for (const [key, list] of Object.entries(next)) {
      if (!key.startsWith(`${time}::`)) continue;
      if (list.length > maxRows) maxRows = list.length;
    }
    return { time, maxRows };
  });

  return { byTimeRoom: next, rowFrames };
}
