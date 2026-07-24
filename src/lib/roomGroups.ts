export const ROOM_GROUPS = ["B", "M前", "M後", "Hope", "Hope 2"] as const;

export type RoomGroup = (typeof ROOM_GROUPS)[number];

/** Canonical room label for schedule matching (B, M前, M後, Hope, Hope 2). */
export function normalizeScheduleRoom(roomRaw: string): RoomGroup | "" {
  const raw = (roomRaw ?? "").trim().toLowerCase();
  if (!raw) return "";
  const compact = raw
    .replace(/\s+/g, "")
    .replace(/[-_]/g, "")
    .replace(/room/g, "")
    .replace(/房間/g, "房");

  if (compact === "b" || compact === "b房") return "B";
  if (compact === "m前" || compact === "m前房" || compact === "mfront" || compact === "m前room") {
    return "M前";
  }
  if (compact === "m後" || compact === "m後房" || compact === "mback" || compact === "m後room") {
    return "M後";
  }
  if (compact === "hope" || compact === "hope房" || compact === "hope1" || compact === "hope1房" || compact === "hopedoor") {
    return "Hope";
  }
  if (compact === "hope2" || compact === "hope2房" || compact === "hopeshelf") return "Hope 2";

  if (compact.includes("m前") || compact.includes("mfront")) return "M前";
  if (compact.includes("m後") || compact.includes("mback")) return "M後";
  // Hope - Shelf / hope2 before generic "hope" (Hopedoor still matches hope*)
  if (compact.includes("hope2") || compact.includes("hopeshelf") || compact.endsWith("shelf")) {
    return "Hope 2";
  }
  if (compact.includes("hope")) return "Hope";
  if (compact === "broom") return "B";

  return "";
}
