import type { ViewerContext } from "@/lib/authz";
import { fetchClassroomNavLinks } from "@/lib/classroomsRegistry";
import { FALLBACK_ROOM_NAV_LINKS, type RoomNavItem } from "@/lib/roomConstants";
import { loadTutorRoomNavLinks, defaultRoomScheduleSearch } from "@/lib/tutorRoomAccess";

/** Serializable nav seed — skip client `/api/me` when provided by RSC. */
export type AppTopNavViewer = {
  role: string | null;
  studentId?: string | null;
  roomNavLinks: RoomNavItem[];
  roomScheduleQuery: string | null;
};

export async function fetchAdminRoomNavLinksCached(): Promise<RoomNavItem[]> {
  return fetchClassroomNavLinks();
}

/** Build nav props from server viewer (one request tree; rooms cached for admin). */
export async function buildAppTopNavViewer(viewer: ViewerContext): Promise<AppTopNavViewer> {
  if (viewer.role === "tutor") {
    return {
      role: "tutor",
      roomNavLinks: await loadTutorRoomNavLinks(viewer),
      roomScheduleQuery: defaultRoomScheduleSearch(viewer),
    };
  }
  if (viewer.role === "student") {
    return {
      role: "student",
      studentId: viewer.studentId,
      roomNavLinks: FALLBACK_ROOM_NAV_LINKS,
      roomScheduleQuery: null,
    };
  }
  if (viewer.role === "admin") {
    return {
      role: "admin",
      roomNavLinks: await fetchClassroomNavLinks(),
      roomScheduleQuery: null,
    };
  }
  return {
    role: viewer.role,
    roomNavLinks: FALLBACK_ROOM_NAV_LINKS,
    roomScheduleQuery: null,
  };
}
