import type { ViewerContext } from "@/lib/authz";
import { FALLBACK_ROOM_NAV_LINKS, type RoomNavItem } from "@/lib/roomConstants";
import { SCHEDULE_CACHE_TAG_CLASSROOMS } from "@/lib/scheduleCacheTags";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildTutorRoomNavLinks,
  defaultRoomScheduleSearch,
} from "@/lib/tutorRoomAccess";
import { unstable_cache } from "next/cache";

/** Serializable nav seed — skip client `/api/me` when provided by RSC. */
export type AppTopNavViewer = {
  role: string | null;
  roomNavLinks: RoomNavItem[];
  roomScheduleQuery: string | null;
};

async function fetchAdminRoomNavLinksUncached(): Promise<RoomNavItem[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("classrooms")
    .select("id, name, slug, sort_order")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data?.length) return FALLBACK_ROOM_NAV_LINKS;
  return data.map((r) => ({
    href: `/rooms/${encodeURIComponent(String(r.slug).trim().toLowerCase())}`,
    label: String(r.name).trim(),
  }));
}

export async function fetchAdminRoomNavLinksCached(): Promise<RoomNavItem[]> {
  return unstable_cache(
    () => fetchAdminRoomNavLinksUncached(),
    ["admin-room-nav-v1"],
    { revalidate: 300, tags: [SCHEDULE_CACHE_TAG_CLASSROOMS] },
  )();
}

/** Build nav props from server viewer (one request tree; rooms cached for admin). */
export async function buildAppTopNavViewer(viewer: ViewerContext): Promise<AppTopNavViewer> {
  if (viewer.role === "tutor") {
    return {
      role: "tutor",
      roomNavLinks: buildTutorRoomNavLinks(viewer.allowedRoomSlugs),
      roomScheduleQuery: defaultRoomScheduleSearch(viewer),
    };
  }
  if (viewer.role === "admin") {
    return {
      role: "admin",
      roomNavLinks: await fetchAdminRoomNavLinksCached(),
      roomScheduleQuery: null,
    };
  }
  return {
    role: viewer.role,
    roomNavLinks: FALLBACK_ROOM_NAV_LINKS,
    roomScheduleQuery: null,
  };
}
