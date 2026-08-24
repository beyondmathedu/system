import { normalizeScheduleRoom, ROOM_GROUPS, type RoomGroup } from "@/lib/roomGroups";
import { FALLBACK_SLUG_TO_SCHEDULE_LABEL, SCHEDULE_LABEL_TO_ROOM_SLUG } from "@/lib/roomConstants";

/** slug → internal timetable room key */
export const SLUG_TO_ROOM_GROUP: Record<string, RoomGroup> = {
  b: "B",
  "m-qian": "M前",
  "m-hou": "M後",
  "m-front": "M前",
  "m-back": "M後",
  hope: "Hope",
  "hope-2": "Hope 2",
};

export const ROOM_GROUP_TO_SLUG: Record<string, string> = {
  B: "b",
  M前: "m-qian",
  M後: "m-hou",
  Hope: "hope",
  "Hope 2": "hope-2",
};

export function roomSlugToGroup(slug: string, fallback: RoomGroup = "B"): RoomGroup {
  const key = String(slug ?? "").trim().toLowerCase();
  return SLUG_TO_ROOM_GROUP[key] ?? fallback;
}

export type RoomDisplayRegistry = {
  displayLabelByGroup: Record<RoomGroup, string>;
  /** Value stored in student schedule JSON when picking a room */
  storageLabelByGroup: Record<RoomGroup, string>;
  nameToGroup: Map<string, RoomGroup>;
  slugByGroup: Record<string, string>;
  /** Classrooms not in the builtin B / M / Hope set, in table order */
  extraGroups: RoomGroup[];
};

export function listScheduleRoomGroups(registry: RoomDisplayRegistry): RoomGroup[] {
  const seen = new Set<string>();
  const out: RoomGroup[] = [];
  for (const group of [...ROOM_GROUPS, ...registry.extraGroups]) {
    if (!group || seen.has(group)) continue;
    seen.add(group);
    out.push(group);
  }
  return out;
}

function defaultLabelByGroup(): Record<RoomGroup, string> {
  return Object.fromEntries(ROOM_GROUPS.map((g) => [g, g])) as Record<RoomGroup, string>;
}

export const DEFAULT_ROOM_DISPLAY_REGISTRY: RoomDisplayRegistry = (() => {
  const displayLabelByGroup = defaultLabelByGroup();
  // Current site display names for Hope rooms (overridden when classrooms load).
  displayLabelByGroup.Hope = "Hope - Door";
  displayLabelByGroup["Hope 2"] = "Hope - Shelf";
  const storageLabelByGroup = defaultLabelByGroup();
  const nameToGroup = new Map<string, RoomGroup>();
  for (const g of ROOM_GROUPS) {
    nameToGroup.set(g.toLowerCase(), g);
  }
  for (const [slug, label] of Object.entries(FALLBACK_SLUG_TO_SCHEDULE_LABEL)) {
    const group = SLUG_TO_ROOM_GROUP[slug];
    if (group) nameToGroup.set(label.toLowerCase(), group);
  }
  nameToGroup.set("hope - door", "Hope");
  nameToGroup.set("hope door", "Hope");
  nameToGroup.set("hope - shelf", "Hope 2");
  nameToGroup.set("hope shelf", "Hope 2");
  return {
    displayLabelByGroup,
    storageLabelByGroup,
    nameToGroup,
    slugByGroup: { ...ROOM_GROUP_TO_SLUG },
    extraGroups: [],
  };
})();

export function roomGroupToSlug(
  group: RoomGroup,
  registry: RoomDisplayRegistry = DEFAULT_ROOM_DISPLAY_REGISTRY,
): string {
  const fromRegistry = registry.slugByGroup[group];
  if (fromRegistry) return fromRegistry;
  const fromBuiltin = ROOM_GROUP_TO_SLUG[group];
  if (fromBuiltin) return fromBuiltin;
  const fromLabel = SCHEDULE_LABEL_TO_ROOM_SLUG[group];
  if (fromLabel) return fromLabel;
  const fromName = String(group)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (fromName) return fromName;
  return "b";
}

export function buildRoomDisplayRegistry(
  rows: Array<{ name?: string | null; slug?: string | null }> | null | undefined,
): RoomDisplayRegistry {
  const displayLabelByGroup = defaultLabelByGroup();
  const storageLabelByGroup = defaultLabelByGroup();
  const nameToGroup = new Map<string, RoomGroup>();
  const slugByGroup: Record<string, string> = { ...ROOM_GROUP_TO_SLUG };
  const extraGroups: RoomGroup[] = [];

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
    if (!name) continue;
    const builtin = SLUG_TO_ROOM_GROUP[slug];
    if (builtin) {
      displayLabelByGroup[builtin] = name;
      // Keep schedule JSON on canonical group keys (Hope / Hope 2), not display
      // names like "Hope - Door" — otherwise edits/normalization fight each other.
      storageLabelByGroup[builtin] = builtin;
      if (slug) slugByGroup[builtin] = slug;
      nameToGroup.set(name.toLowerCase(), builtin);
      nameToGroup.set(builtin.toLowerCase(), builtin);
      continue;
    }
    const extraGroup = name;
    extraGroups.push(extraGroup);
    displayLabelByGroup[extraGroup] = name;
    storageLabelByGroup[extraGroup] = extraGroup;
    if (slug) slugByGroup[extraGroup] = slug;
    nameToGroup.set(name.toLowerCase(), extraGroup);
    if (slug) nameToGroup.set(slug, extraGroup);
  }

  // Stable aliases so Door/Shelf (and legacy Hope 1) resolve even if a row is missing.
  nameToGroup.set("hope - door", "Hope");
  nameToGroup.set("hope door", "Hope");
  nameToGroup.set("hope1", "Hope");
  nameToGroup.set("hope 1", "Hope");
  nameToGroup.set("hope - shelf", "Hope 2");
  nameToGroup.set("hope shelf", "Hope 2");
  nameToGroup.set("hope2", "Hope 2");

  return { displayLabelByGroup, storageLabelByGroup, nameToGroup, slugByGroup, extraGroups };
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
