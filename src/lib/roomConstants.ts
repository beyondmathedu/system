import { normalizeScheduleRoom } from "@/lib/roomGroups";

/**
 * Canonical room keys stored in student schedule JSON.
 * Display names (e.g. "Hope - Door") come from classrooms.name via the display registry.
 */
export const FALLBACK_SLUG_TO_SCHEDULE_LABEL: Record<string, string> = {
  b: "B",
  "m-qian": "M前",
  "m-hou": "M後",
  "m-front": "M前",
  "m-back": "M後",
  hope: "Hope",
  "hope-2": "Hope 2",
};

export const SCHEDULE_LABEL_TO_ROOM_SLUG: Record<string, string> = {
  B: "b",
  M前: "m-qian",
  M後: "m-hou",
  Hope: "hope",
  "Hope 2": "hope-2",
};

export function buildRoomPageHref(scheduleLabel: string, query = ""): string | null {
  const trimmed = scheduleLabel.trim();
  let slug = SCHEDULE_LABEL_TO_ROOM_SLUG[trimmed];
  if (!slug) {
    const group = normalizeScheduleRoom(trimmed);
    if (group) slug = SCHEDULE_LABEL_TO_ROOM_SLUG[group];
  }
  if (!slug) return null;
  const base = `/rooms/${encodeURIComponent(slug)}`;
  return query ? `${base}?${query}` : base;
}

export const FALLBACK_ROOM_PAGE_META: Record<string, { label: string; description: string }> = {
  b: { label: "B", description: "Room B 排課與使用資訊" },
  "m-qian": { label: "M前", description: "M 前座 Room 資訊" },
  "m-hou": { label: "M後", description: "M 後座 Room 資訊" },
  "m-front": { label: "M前", description: "M 前座 Room 資訊" },
  "m-back": { label: "M後", description: "M 後座 Room 資訊" },
  hope: { label: "Hope - Door", description: "Hope - Door Room 資訊" },
  "hope-2": { label: "Hope - Shelf", description: "Hope - Shelf Room 資訊" },
};

export type RoomNavItem = { href: string; label: string };

export const FALLBACK_ROOM_NAV_LINKS: RoomNavItem[] = [
  { href: "/rooms/b", label: "B" },
  { href: "/rooms/m-qian", label: "M前" },
  { href: "/rooms/m-hou", label: "M後" },
  { href: "/rooms/hope", label: "Hope - Door" },
  { href: "/rooms/hope-2", label: "Hope - Shelf" },
];
