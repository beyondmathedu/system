"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoomGroup } from "@/lib/dayTimetableShared";
import { resolveScheduleRoomPickerValue, ROOM_GROUPS } from "@/lib/dayTimetableShared";
import {
  buildRoomDisplayRegistry,
  DEFAULT_ROOM_DISPLAY_REGISTRY,
  formatRoomDisplayLabel,
  listScheduleRoomGroups,
  roomGroupDisplayLabel,
  roomGroupStorageLabel,
  type RoomDisplayRegistry,
} from "@/lib/roomDisplayRegistry";
import { supabase } from "@/lib/supabase";

export function useRoomDisplayRegistry(): RoomDisplayRegistry {
  const [registry, setRegistry] = useState<RoomDisplayRegistry>(DEFAULT_ROOM_DISPLAY_REGISTRY);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("classrooms")
      .select("name, slug, sort_order")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error || !data?.length) return;
    setRegistry(buildRoomDisplayRegistry(data));
  }, []);

  useEffect(() => {
    // Initial + event-driven refresh from classrooms table (external system).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch registry on mount / classroom updates
    void load();
    const onUpdate = () => {
      void load();
    };
    window.addEventListener("beyondmath:classrooms-updated", onUpdate);
    return () => window.removeEventListener("beyondmath:classrooms-updated", onUpdate);
  }, [load]);

  return registry;
}

/** Client helpers for room pickers and labels (reads classrooms table). */
export function useRoomDisplayLabels() {
  const registry = useRoomDisplayRegistry();
  const formatRoom = useCallback(
    (raw: string) => formatRoomDisplayLabel(raw, registry),
    [registry],
  );
  const pickerLabel = useCallback(
    (group: RoomGroup) => roomGroupDisplayLabel(group, registry),
    [registry],
  );
  const pickerToStorage = useCallback(
    (pickerValue: string) => {
      const group = resolveScheduleRoomPickerValue(pickerValue, ROOM_GROUPS[0], registry);
      return roomGroupStorageLabel(group, registry);
    },
    [registry],
  );
  const roomPickerOptions = listScheduleRoomGroups(registry);
  return { registry, formatRoom, pickerLabel, pickerToStorage, roomPickerOptions };
}
