import { normalizeScheduleRoom, ROOM_GROUPS, type RoomGroup } from "@/lib/roomGroups";
import { FALLBACK_SLUG_TO_SCHEDULE_LABEL } from "@/lib/roomConstants";

/** slug → internal timetable room key */
export const SLUG_TO_ROOM_GROUP: Record<string, RoomGroup> = {
  b: "B",
  "m-qian": "M前",
  "m-hou": "M後",
  hope: "Hope",
  "hope-2": "Hope 2",
};

export type RoomDisplayRegistry = {
  displayLabelByGroup: Record<RoomGroup, string>;
  /** Value stored in student schedule JSON when picking a room */
  storageLabelByGroup: Record<RoomGroup, string>;
  nameToGroup: Map<string, RoomGroup>;
};

function defaultLabelByGroup(): Record<RoomGroup, string> {
  return Object.fromEntries(ROOM_GROUPS.map((g) => [g, g])) as Record<RoomGroup, string>;
}

export const DEFAULT_ROOM_DISPLAY_REGISTRY: RoomDisplayRegistry = (() => {
  const displayLabelByGroup = defaultLabelByGroup();
  const storageLabelByGroup = defaultLabelByGroup();
  const nameToGroup = new Map<string, RoomGroup>();
  for (const g of ROOM_GROUPS) {
    nameToGroup.set(g.toLowerCase(), g);
  }
  for (const [slug, label] of Object.entries(FALLBACK_SLUG_TO_SCHEDULE_LABEL)) {
    const group = SLUG_TO_ROOM_GROUP[slug];
    if (group) nameToGroup.set(label.toLowerCase(), group);
  }
  return { displayLabelByGroup, storageLabelByGroup, nameToGroup };
})();

export function buildRoomDisplayRegistry(
  rows: Array<{ name?: string | null; slug?: string | null }> | null | undefined,
): RoomDisplayRegistry {
  const displayLabelByGroup = defaultLabelByGroup();
  const storageLabelByGroup = defaultLabelByGroup();
  const nameToGroup = new Map<string, RoomGroup>();

  for (const g of ROOM_GROUPS) {
    nameToGroup.set(g.toLowerCase(), g);
  }
  for (const [slug, label] of Object.entries(FALLBACK_SLUG_TO_SCHEDULE_LABEL)) {
    const group = SLUG_TO_ROOM_GROUP[slug];
    if (group) nameToGroup.set(label.toLowerCase(), group);
  }

  for (const row of rows ?? []) {
    const slug = String(row.slug ?? "").trim().toLowerCase();
    const name = String(row.name ?? "").trim();
    const group = SLUG_TO_ROOM_GROUP[slug];
    if (!group || !name) continue;
    displayLabelByGroup[group] = name;
    storageLabelByGroup[group] = name;
    nameToGroup.set(name.toLowerCase(), group);
  }

  return { displayLabelByGroup, storageLabelByGroup, nameToGroup };
}

export function resolveRoomGroupFromRegistry(
  raw: string,
  registry: RoomDisplayRegistry = DEFAULT_ROOM_DISPLAY_REGISTRY,
): RoomGroup | "" {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const hit = registry.nameToGroup.get(trimmed.toLowerCase());
  if (hit) return hit;
  return normalizeScheduleRoom(trimmed);
}

export function formatRoomDisplayLabel(
  raw: string,
  registry: RoomDisplayRegistry = DEFAULT_ROOM_DISPLAY_REGISTRY,
): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const group = resolveRoomGroupFromRegistry(trimmed, registry);
  if (group) return registry.displayLabelByGroup[group] ?? group;
  return trimmed;
}

export function roomGroupDisplayLabel(
  group: RoomGroup,
  registry: RoomDisplayRegistry = DEFAULT_ROOM_DISPLAY_REGISTRY,
): string {
  return registry.displayLabelByGroup[group] ?? group;
}

export function roomGroupStorageLabel(
  group: RoomGroup,
  registry: RoomDisplayRegistry = DEFAULT_ROOM_DISPLAY_REGISTRY,
): string {
  return registry.storageLabelByGroup[group] ?? group;
}

export function scheduleRoomsMatchWithRegistry(
  storedRoom: string,
  expectedRoom: string,
  registry: RoomDisplayRegistry = DEFAULT_ROOM_DISPLAY_REGISTRY,
): boolean {
  if (storedRoom.trim() === expectedRoom.trim()) return true;
  const a = resolveRoomGroupFromRegistry(storedRoom, registry);
  const b = resolveRoomGroupFromRegistry(expectedRoom, registry);
  if (a && b) return a === b;
  return false;
}
