/** 課表 JSON 裡 room 欄位須與此字串完全一致時，篩選才會命中。 */
export const FALLBACK_SLUG_TO_SCHEDULE_LABEL: Record<string, string> = {
  b: "B",
  "m-qian": "M前",
  "m-hou": "M後",
  hope: "Hope",
  "hope-2": "Hope 2",
};

export const FALLBACK_ROOM_PAGE_META: Record<string, { label: string; description: string }> = {
  b: { label: "B", description: "Room B 排課與使用資訊" },
  "m-qian": { label: "M前", description: "M 前座 Room 資訊" },
  "m-hou": { label: "M後", description: "M 後座 Room 資訊" },
  hope: { label: "Hope", description: "Hope Room 資訊" },
  "hope-2": { label: "Hope 2", description: "Hope 2 Room 資訊" },
};

export type RoomNavItem = { href: string; label: string };

export const FALLBACK_ROOM_NAV_LINKS: RoomNavItem[] = [
  { href: "/rooms/b", label: "B" },
  { href: "/rooms/m-qian", label: "M前" },
  { href: "/rooms/m-hou", label: "M後" },
  { href: "/rooms/hope", label: "Hope" },
  { href: "/rooms/hope-2", label: "Hope 2" },
];
